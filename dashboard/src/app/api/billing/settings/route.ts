import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { updateBilling, getBilling } from "@/lib/api/workers-client";

/**
 * GET /api/billing/settings
 * Returns current auto-reup settings
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { billing } = await getBilling(user.userId);
    
    return NextResponse.json({
      autoReupEnabled: billing.auto_reup_enabled === 1,
      autoReupAmountCents: billing.auto_reup_amount_cents,
      autoReupTriggerCents: billing.auto_reup_trigger_cents,
      monthlyCapCents: billing.monthly_cap_cents,
    });
  } catch (error) {
    console.error("[billing/settings] Error:", error);
    return NextResponse.json({ error: "Failed to get settings" }, { status: 500 });
  }
}

/**
 * PATCH /api/billing/settings
 * Updates auto-reup settings
 */
export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser(request);
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { autoReupEnabled, autoReupAmountCents, autoReupTriggerCents, monthlyCapCents } = body;

    // Validate inputs
    if (autoReupAmountCents !== undefined) {
      if (typeof autoReupAmountCents !== 'number' || autoReupAmountCents < 500 || autoReupAmountCents > 50000) {
        return NextResponse.json({ 
          error: "Recharge amount must be between $5 and $500" 
        }, { status: 400 });
      }
    }

    if (autoReupTriggerCents !== undefined) {
      if (typeof autoReupTriggerCents !== 'number' || autoReupTriggerCents < 100 || autoReupTriggerCents > 10000) {
        return NextResponse.json({ 
          error: "Trigger threshold must be between $1 and $100" 
        }, { status: 400 });
      }
    }

    // Build update payload (only include defined values)
    const updatePayload: {
      autoReupEnabled?: boolean;
      autoReupAmountCents?: number;
      autoReupTriggerCents?: number;
      monthlyCapCents?: number | null;
    } = {};

    if (autoReupEnabled !== undefined) {
      updatePayload.autoReupEnabled = autoReupEnabled;
    }
    if (autoReupAmountCents !== undefined) {
      updatePayload.autoReupAmountCents = autoReupAmountCents;
    }
    if (autoReupTriggerCents !== undefined) {
      updatePayload.autoReupTriggerCents = autoReupTriggerCents;
    }
    if (monthlyCapCents !== undefined) {
      updatePayload.monthlyCapCents = monthlyCapCents;
    }

    // Update via Workers API
    const { billing } = await updateBilling(user.userId, updatePayload);

    return NextResponse.json({
      success: true,
      autoReupEnabled: billing.auto_reup_enabled === 1,
      autoReupAmountCents: billing.auto_reup_amount_cents,
      autoReupTriggerCents: billing.auto_reup_trigger_cents,
      monthlyCapCents: billing.monthly_cap_cents,
    });
  } catch (error) {
    console.error("[billing/settings] Update error:", error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : "Failed to update settings" 
    }, { status: 500 });
  }
}
