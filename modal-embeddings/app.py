"""
MemoryRouter Embedding Service on Modal
========================================
Self-hosted BGE-large-en-v1.5 embeddings at ~1/100th the cost of OpenAI.

Deploy: modal deploy app.py
Test: curl https://memoryrouter-embeddings--embed.modal.run/embed -X POST -H "Content-Type: application/json" -d '{"texts": ["hello world"]}'
"""

import modal

# Define the Modal app
app = modal.App("memoryrouter-embeddings")

# Docker image with dependencies
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "sentence-transformers>=2.2.0",
    "torch>=2.0.0",
    "numpy>=1.24.0",
    "fastapi>=0.100.0",
)


@app.cls(
    image=image,
    gpu="T4",  # Cheapest GPU, plenty for embeddings
    container_idle_timeout=300,  # Keep warm for 5 min after last request
    allow_concurrent_inputs=100,  # Handle many requests per container
)
class EmbeddingService:
    """Stella 400M embedding service — top retrieval model for RAG.
    
    Stella beats BGE-large on retrieval benchmarks:
    - MTEB Overall: 66.15 (vs 64.23 for BGE-large)
    - Best-in-class retrieval for commercial use
    - MIT licensed, 400M params, fits easily on T4
    """
    
    model_name: str = "NovaSearch/stella_en_400M_v5"
    
    @modal.enter()
    def load_model(self):
        """Load model once when container starts."""
        from sentence_transformers import SentenceTransformer
        import torch
        
        print(f"Loading {self.model_name}...")
        self.model = SentenceTransformer(self.model_name)
        self.model.eval()
        
        # Warmup inference
        _ = self.model.encode(["warmup"], normalize_embeddings=True)
        print(f"Model loaded and ready on {torch.cuda.get_device_name(0)}")
    
    @modal.method()
    def embed(self, texts: list[str], normalize: bool = True) -> dict:
        """Generate embeddings for a list of texts."""
        import numpy as np
        import time
        
        start = time.perf_counter()
        
        # Generate embeddings
        embeddings = self.model.encode(
            texts,
            normalize_embeddings=normalize,
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        
        elapsed_ms = (time.perf_counter() - start) * 1000
        
        return {
            "embeddings": embeddings.tolist(),
            "dims": embeddings.shape[1],
            "count": len(texts),
            "model": self.model_name,
            "latency_ms": round(elapsed_ms, 2),
        }
    
    @modal.method()
    def health(self) -> dict:
        """Health check endpoint."""
        import torch
        return {
            "status": "healthy",
            "model": self.model_name,
            "gpu": torch.cuda.get_device_name(0),
            "dims": 1024,
        }


# FastAPI web endpoint
@app.function(image=image, allow_concurrent_inputs=100)
@modal.asgi_app()
def web():
    """FastAPI web server for HTTP access."""
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel
    import os
    
    fastapi_app = FastAPI(title="MemoryRouter Embeddings")
    service = EmbeddingService()
    
    class EmbedRequest(BaseModel):
        texts: list[str]
        normalize: bool = True
    
    @fastapi_app.get("/health")
    async def health():
        return service.health.remote()
    
    @fastapi_app.post("/embed")
    async def embed(req: EmbedRequest):
        if not req.texts:
            raise HTTPException(400, "texts array required")
        if len(req.texts) > 100:
            raise HTTPException(400, "max 100 texts per request")
        
        return service.embed.remote(req.texts, req.normalize)
    
    @fastapi_app.post("/v1/embeddings")
    async def openai_compatible(req: dict):
        """OpenAI-compatible endpoint for drop-in replacement."""
        input_text = req.get("input", [])
        if isinstance(input_text, str):
            input_text = [input_text]
        
        if not input_text:
            raise HTTPException(400, "input required")
        
        result = service.embed.remote(input_text, normalize=True)
        
        # Return OpenAI-compatible format
        return {
            "object": "list",
            "model": result["model"],
            "data": [
                {
                    "object": "embedding",
                    "index": i,
                    "embedding": emb,
                }
                for i, emb in enumerate(result["embeddings"])
            ],
            "usage": {
                "prompt_tokens": sum(len(t.split()) for t in input_text),
                "total_tokens": sum(len(t.split()) for t in input_text),
            },
        }
    
    return fastapi_app


# Keep-warm scheduled function
@app.function(schedule=modal.Period(minutes=4), image=image)
def keep_warm():
    """Ping every 4 min to prevent cold starts."""
    service = EmbeddingService()
    result = service.health.remote()
    print(f"Keep-warm ping: {result}")
