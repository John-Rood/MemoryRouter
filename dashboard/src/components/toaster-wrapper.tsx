"use client";

import { Toaster } from "sonner";

export function ToasterWrapper() {
  return (
    <Toaster 
      position="bottom-right" 
      theme="dark"
      toastOptions={{
        style: {
          background: 'hsl(240 6% 6%)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          color: 'white',
        },
      }}
    />
  );
}
