/**
 * Billing Service Unit Tests
 * 
 * Reference: memoryrouter-test-strategy.md Section 3.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  checkQuota,
  getBillingOverview,
  recordUsage,
  getUserBilling,
  updateUserBilling,
  startGracePeriod,
  suspendAccount,
  restoreAccount,
} from '../../src/billing/service';
import { PRICING } from '../../src/billing/types';

describe('Billing Service', () => {
  describe('checkQuota', () => {
    beforeEach(async () => {
      // Reset test user state
      await updateUserBilling('test_user', {
        hasPaymentMethod: false,
        totalTokensUsed: BigInt(0),
        totalTokensReported: BigInt(0),
        billingStatus: 'free',
      });
    });

    it('allows requests under quota', async () => {
      await updateUserBilling('test_user', {
        totalTokensUsed: BigInt(5_000_000),
        billingStatus: 'free',
        hasPaymentMethod: false,
      });

      const result = await checkQuota('test_user');
      
      expect(result.allowed).toBe(true);
      expect(result.isFreeTier).toBe(true);
    });

    it('rejects requests at quota limit without payment', async () => {
      await updateUserBilling('test_user', {
        totalTokensUsed: BigInt(PRICING.FREE_TIER_TOKENS),
        billingStatus: 'free',
        hasPaymentMethod: false,
      });

      const result = await checkQuota('test_user');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('FREE_TIER_EXHAUSTED');
      expect(result.paymentRequired).toBe(true);
    });

    it('allows requests over quota with payment method', async () => {
      await updateUserBilling('test_user', {
        totalTokensUsed: BigInt(50_000_000),
        billingStatus: 'active',
        hasPaymentMethod: true,
      });

      const result = await checkQuota('test_user');
      
      expect(result.allowed).toBe(true);
      expect(result.isFreeTier).toBe(false);
      expect(result.tokensRemaining).toBe(Infinity);
    });

    it('rejects suspended accounts', async () => {
      await updateUserBilling('test_user', {
        totalTokensUsed: BigInt(50_000_000),
        billingStatus: 'suspended',
        hasPaymentMethod: true,
      });

      const result = await checkQuota('test_user');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('ACCOUNT_SUSPENDED');
    });

    it('allows grace period with warning', async () => {
      const gracePeriodEnd = new Date();
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 5);
      
      await updateUserBilling('test_user', {
        totalTokensUsed: BigInt(50_000_000),
        billingStatus: 'grace_period',
        hasPaymentMethod: true,
        gracePeriodEndsAt: gracePeriodEnd,
      });

      const result = await checkQuota('test_user');
      
      expect(result.allowed).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.gracePeriodEndsAt).toBeDefined();
    });

    it('allows enterprise users without quota check', async () => {
      await updateUserBilling('test_user', {
        totalTokensUsed: BigInt(1_000_000_000), // 1B tokens
        billingStatus: 'enterprise',
        hasPaymentMethod: true,
      });

      const result = await checkQuota('test_user');
      
      expect(result.allowed).toBe(true);
      expect(result.tokensRemaining).toBe(Infinity);
    });

    it('initializes new users with free tier', async () => {
      const result = await checkQuota('brand_new_user');
      
      expect(result.allowed).toBe(true);
      expect(result.isFreeTier).toBe(true);
      expect(result.tokensUsed).toBe(BigInt(0));
      expect(result.tokensRemaining).toBe(PRICING.FREE_TIER_TOKENS);
    });
  });

  describe('getBillingOverview', () => {
    it('returns correct overview for free tier user', async () => {
      await updateUserBilling('overview_test', {
        hasPaymentMethod: false,
        totalTokensUsed: BigInt(3_000_000),
        totalTokensReported: BigInt(0),
        billingStatus: 'free',
      });

      const overview = await getBillingOverview('overview_test');
      
      expect(overview.status).toBe('free');
      expect(overview.plan).toBe('free');
      expect(overview.usage.current_period.tokens_used).toBe(3_000_000);
      expect(overview.usage.free_tier.remaining).toBe(7_000_000);
      expect(overview.payment_method?.has_payment_method).toBe(false);
    });

    it('returns correct overview for paid user', async () => {
      await updateUserBilling('paid_overview_test', {
        hasPaymentMethod: true,
        totalTokensUsed: BigInt(15_000_000),
        totalTokensReported: BigInt(5_000_000),
        billingStatus: 'active',
        stripeCustomerId: 'cus_test',
        stripeSubscriptionId: 'sub_test',
      });

      const overview = await getBillingOverview('paid_overview_test');
      
      expect(overview.status).toBe('active');
      expect(overview.plan).toBe('usage_based');
      expect(overview.usage.current_period.tokens_billable).toBe(5_000_000);
      expect(overview.usage.free_tier.exhausted).toBe(true);
      expect(overview.next_invoice).toBeDefined();
    });

    it('returns default overview for new user', async () => {
      const overview = await getBillingOverview('nonexistent_user');
      
      expect(overview.status).toBe('free');
      expect(overview.usage.current_period.tokens_used).toBe(0);
      expect(overview.usage.free_tier.remaining).toBe(PRICING.FREE_TIER_TOKENS);
    });
  });

  describe('recordUsage', () => {
    it('increments user token count', async () => {
      await updateUserBilling('usage_test', {
        hasPaymentMethod: false,
        totalTokensUsed: BigInt(1_000_000),
        totalTokensReported: BigInt(0),
        billingStatus: 'free',
      });

      await recordUsage({
        userId: 'usage_test',
        tokensInput: 500,
        tokensOutput: 300,
      });

      const billing = await getUserBilling('usage_test');
      expect(billing?.totalTokensUsed).toBe(BigInt(1_000_800));
    });

    it('records usage with metadata', async () => {
      await updateUserBilling('metadata_test', {
        hasPaymentMethod: false,
        totalTokensUsed: BigInt(0),
        totalTokensReported: BigInt(0),
        billingStatus: 'free',
      });

      await recordUsage({
        userId: 'metadata_test',
        memoryKeyId: 'mk_test_123',
        requestId: 'req_456',
        tokensInput: 1000,
        tokensOutput: 500,
        tokensRetrieved: 2000,
        tokensEphemeral: 3000,
        model: 'gpt-4',
        provider: 'openai',
      });

      const billing = await getUserBilling('metadata_test');
      expect(billing?.totalTokensUsed).toBe(BigInt(1500));
    });
  });

  describe('Grace Period Management', () => {
    it('starts grace period correctly', async () => {
      await updateUserBilling('grace_test', {
        hasPaymentMethod: true,
        totalTokensUsed: BigInt(15_000_000),
        billingStatus: 'active',
      });

      await startGracePeriod('grace_test');

      const billing = await getUserBilling('grace_test');
      expect(billing?.billingStatus).toBe('grace_period');
      expect(billing?.gracePeriodEndsAt).toBeDefined();
      
      // Should be ~7 days from now
      const daysUntilEnd = Math.ceil(
        (billing!.gracePeriodEndsAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      expect(daysUntilEnd).toBe(PRICING.GRACE_PERIOD_DAYS);
    });

    it('suspends account after grace period', async () => {
      await updateUserBilling('suspend_test', {
        hasPaymentMethod: true,
        totalTokensUsed: BigInt(15_000_000),
        billingStatus: 'grace_period',
      });

      await suspendAccount('suspend_test');

      const billing = await getUserBilling('suspend_test');
      expect(billing?.billingStatus).toBe('suspended');
    });

    it('restores account after payment', async () => {
      await updateUserBilling('restore_test', {
        hasPaymentMethod: true,
        totalTokensUsed: BigInt(15_000_000),
        billingStatus: 'suspended',
      });

      await restoreAccount('restore_test');

      const billing = await getUserBilling('restore_test');
      expect(billing?.billingStatus).toBe('active');
      expect(billing?.gracePeriodEndsAt).toBeUndefined();
    });
  });
});
