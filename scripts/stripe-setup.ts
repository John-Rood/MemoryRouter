#!/usr/bin/env npx tsx

/**
 * Stripe Product & Price Setup Script
 * 
 * Creates the MemoryRouter metered product and price in Stripe.
 * Run this script once during initial setup.
 * 
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_xxx npx tsx scripts/stripe-setup.ts
 * 
 * Or for production:
 *   STRIPE_SECRET_KEY=sk_live_xxx npx tsx scripts/stripe-setup.ts
 * 
 * Reference: memoryrouter-stripe-spec.md Section 2
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const PRODUCT_CONFIG = {
  name: 'MemoryRouter Memory Tokens',
  description: 'Persistent AI memory storage for input and output tokens',
  unitLabel: 'tokens',
  metadata: {
    type: 'memory_tokens',
    version: '1.0',
  },
};

const PRICE_CONFIG = {
  currency: 'usd',
  unitAmount: 50, // $0.50 per unit (1 million tokens)
  recurring: {
    interval: 'month' as const,
    usageType: 'metered' as const,
    aggregateUsage: 'sum' as const,
  },
  metadata: {
    tokens_per_unit: '1000000',
    unit_label: 'million tokens',
    price_per_million: '0.50',
    free_tier_tokens: '10000000',
  },
};

// =============================================================================
// TYPES
// =============================================================================

interface StripeProduct {
  id: string;
  name: string;
  description?: string;
}

interface StripePrice {
  id: string;
  product: string;
  unit_amount: number;
  currency: string;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  
  if (!STRIPE_SECRET_KEY) {
    console.error('❌ STRIPE_SECRET_KEY environment variable is required');
    console.log('\nUsage:');
    console.log('  STRIPE_SECRET_KEY=sk_test_xxx npx tsx scripts/stripe-setup.ts');
    process.exit(1);
  }
  
  const isTestMode = STRIPE_SECRET_KEY.startsWith('sk_test_');
  console.log(`\n🔑 Using ${isTestMode ? 'TEST' : 'LIVE'} mode\n`);
  
  if (!isTestMode) {
    console.log('⚠️  WARNING: You are using a LIVE key!');
    console.log('   This will create a real product in your Stripe account.\n');
  }
  
  try {
    // Step 1: Create Product
    console.log('📦 Creating product...');
    const product = await createProduct(STRIPE_SECRET_KEY);
    console.log(`   ✓ Product created: ${product.id}`);
    
    // Step 2: Create Price
    console.log('💰 Creating price...');
    const price = await createPrice(STRIPE_SECRET_KEY, product.id);
    console.log(`   ✓ Price created: ${price.id}`);
    
    // Step 3: Output environment variables
    console.log('\n' + '='.repeat(60));
    console.log('✅ Setup complete! Add these to your .env file:\n');
    console.log(`STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}`);
    console.log(`STRIPE_PRODUCT_ID=${product.id}`);
    console.log(`STRIPE_PRICE_ID=${price.id}`);
    console.log('\n' + '='.repeat(60));
    
    // Step 4: Webhook setup reminder
    console.log('\n📌 Next steps:');
    console.log('   1. Set up webhook endpoint in Stripe Dashboard');
    console.log('   2. Point it to: https://api.memoryrouter.ai/webhooks/stripe');
    console.log('   3. Subscribe to these events:');
    console.log('      - customer.created');
    console.log('      - customer.updated');
    console.log('      - customer.subscription.created');
    console.log('      - customer.subscription.updated');
    console.log('      - customer.subscription.deleted');
    console.log('      - invoice.created');
    console.log('      - invoice.paid');
    console.log('      - invoice.payment_failed');
    console.log('      - payment_method.attached');
    console.log('      - payment_method.detached');
    console.log('   4. Save the webhook signing secret to your .env:\n');
    console.log('      STRIPE_WEBHOOK_SECRET=whsec_xxx');
    console.log('');
    
  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

async function createProduct(apiKey: string): Promise<StripeProduct> {
  const response = await fetch('https://api.stripe.com/v1/products', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      'name': PRODUCT_CONFIG.name,
      'description': PRODUCT_CONFIG.description,
      'unit_label': PRODUCT_CONFIG.unitLabel,
      'metadata[type]': PRODUCT_CONFIG.metadata.type,
      'metadata[version]': PRODUCT_CONFIG.metadata.version,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create product: ${JSON.stringify(error)}`);
  }
  
  return response.json();
}

async function createPrice(apiKey: string, productId: string): Promise<StripePrice> {
  const response = await fetch('https://api.stripe.com/v1/prices', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      'product': productId,
      'currency': PRICE_CONFIG.currency,
      'unit_amount': PRICE_CONFIG.unitAmount.toString(),
      'recurring[interval]': PRICE_CONFIG.recurring.interval,
      'recurring[usage_type]': PRICE_CONFIG.recurring.usageType,
      'recurring[aggregate_usage]': PRICE_CONFIG.recurring.aggregateUsage,
      'billing_scheme': 'per_unit',
      'metadata[tokens_per_unit]': PRICE_CONFIG.metadata.tokens_per_unit,
      'metadata[unit_label]': PRICE_CONFIG.metadata.unit_label,
      'metadata[price_per_million]': PRICE_CONFIG.metadata.price_per_million,
      'metadata[free_tier_tokens]': PRICE_CONFIG.metadata.free_tier_tokens,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create price: ${JSON.stringify(error)}`);
  }
  
  return response.json();
}

// =============================================================================
// RUN
// =============================================================================

main().catch(console.error);
