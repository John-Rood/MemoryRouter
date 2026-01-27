/**
 * Billing Module Index
 * 
 * Exports all billing-related functionality.
 */

// Types
export * from './types';

// Token counting
export {
  countTokens,
  countMessageTokens,
  countMemoryTokens,
  calculateCost,
  calculateBillableTokens,
  tokensToStripeUnits,
  checkRemainingQuota,
  createUsageRecordInput,
  getFreeTierWarnings,
} from './tokens';

// Billing service
export {
  getUserBilling,
  updateUserBilling,
  recordUsage,
  incrementUserTokens,
  checkQuota,
  getBillingOverview,
  getUsageDetails,
  getPaymentMethods,
  getInvoices,
  createSubscription,
  reportUsageToStripe,
  startGracePeriod,
  suspendAccount,
  restoreAccount,
  transitionToPaid,
  isEventProcessed,
  logStripeEvent,
  markEventProcessed,
} from './service';

// Middleware
export {
  quotaCheckMiddleware,
  quotaInfoMiddleware,
  shouldMeterRequest,
  getFreeTierWarning,
  formatQuotaError,
} from './middleware';

// Routes
export { default as billingRoutes } from './routes';

// Webhook handlers
export { default as webhookRoutes, processStripeEvent } from './webhooks';
