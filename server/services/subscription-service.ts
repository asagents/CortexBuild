/**
 * Subscription Management Service
 * Handles billing, payment processing, and subscription lifecycle
 */

import { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

export interface SubscriptionPlan {
  id: string;
  name: string;
  tier: 'free' | 'starter' | 'pro' | 'enterprise';
  price: number; // Monthly price in cents
  requests: number;
  features: string[];
}

export interface SubscriptionData {
  userId: string;
  tier: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  status: 'active' | 'canceled' | 'past_due' | 'unpaid' | 'trialing';
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  trialEndsAt?: Date;
}

export class SubscriptionService {
  private stripe: Stripe;

  constructor(private supabase: SupabaseClient) {
    if (process.env.STRIPE_SECRET_KEY) {
      this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2024-10-28.acacia',
      });
    }
  }

  getPlans(): SubscriptionPlan[] {
    return [
      {
        id: 'free',
        name: 'Free',
        tier: 'free',
        price: 0,
        requests: 100,
        features: [
          '100 AI requests/month',
          'Basic code generation',
          'Community support',
          'Standard models only'
        ]
      },
      {
        id: 'starter',
        name: 'Starter',
        tier: 'starter',
        price: 2900,
        requests: 1000,
        features: [
          '1,000 AI requests/month',
          'Advanced code generation',
          'Priority support',
          'All AI models',
          'Basic analytics'
        ]
      },
      {
        id: 'pro',
        name: 'Professional',
        tier: 'pro',
        price: 9900,
        requests: 10000,
        features: [
          '10,000 AI requests/month',
          'Advanced workflows',
          'Priority support',
          'All AI models',
          'Advanced analytics',
          'Custom integrations'
        ]
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        tier: 'enterprise',
        price: 29900,
        requests: 100000,
        features: [
          '100,000 AI requests/month',
          'Unlimited workflows',
          'Dedicated support',
          'All AI models',
          'Advanced analytics',
          'Custom integrations',
          'SLA guarantee',
          'Custom training'
        ]
      }
    ];
  }

  async createStripeCustomer(userId: string, email: string, name: string): Promise<string> {
    if (!this.stripe) {
      throw new Error('Stripe not configured');
    }

    const { data: existing } = await this.supabase
      .from('sdk_profiles')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    if (existing?.stripe_customer_id) {
      return existing.stripe_customer_id;
    }

    const customer = await this.stripe.customers.create({
      email,
      name,
      metadata: { userId }
    });

    await this.supabase
      .from('sdk_profiles')
      .update({ stripe_customer_id: customer.id, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    return customer.id;
  }

  async createSubscription(
    userId: string,
    priceId: string,
    paymentMethodId?: string
  ): Promise<Stripe.Subscription> {
    if (!this.stripe) {
      throw new Error('Stripe not configured');
    }

    const { data: profile, error: profileErr } = await this.supabase
      .from('sdk_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileErr || !profile) {
      throw new Error('Profile not found');
    }

    const customerId = profile.stripe_customer_id || await this.createStripeCustomer(
      userId,
      profile.email || '',
      profile.name || ''
    );

    const subscriptionData: Stripe.SubscriptionCreateParams = {
      customer: customerId,
      items: [{ price: priceId }],
      metadata: { userId },
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent']
    };

    if (paymentMethodId) {
      subscriptionData.default_payment_method = paymentMethodId;
    }

    const subscription = await this.stripe.subscriptions.create(subscriptionData);
    await this.updateSubscriptionFromStripe(userId, subscription);
    return subscription;
  }

  async updateSubscriptionFromStripe(userId: string, subscription: Stripe.Subscription): Promise<void> {
    const currentPeriodStart = new Date(subscription.current_period_start * 1000);
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

    await this.supabase
      .from('sdk_profiles')
      .update({
        subscription_status: subscription.status,
        current_period_start: currentPeriodStart.toISOString(),
        current_period_end: currentPeriodEnd.toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);
  }

  async cancelSubscription(userId: string, cancelAtPeriodEnd = true): Promise<void> {
    const { data: profile, error } = await this.supabase
      .from('sdk_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !profile?.stripe_customer_id) {
      throw new Error('No Stripe subscription found');
    }

    if (!this.stripe) {
      throw new Error('Stripe not configured');
    }

    const subscriptions = await this.stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: 'active'
    });

    if (subscriptions.data.length === 0) {
      throw new Error('No active subscription found');
    }

    const subscription = subscriptions.data[0];

    if (cancelAtPeriodEnd) {
      await this.stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: true
      });
    } else {
      await this.stripe.subscriptions.cancel(subscription.id);
    }

    await this.supabase
      .from('sdk_profiles')
      .update({
        cancel_at_period_end: cancelAtPeriodEnd,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.userId;

        if (userId) {
          await this.updateSubscriptionFromStripe(userId, subscription);
          await this.recordSubscriptionChange(
            userId,
            'existing',
            subscription.status,
            `Stripe ${event.type}`,
            'system',
            event.id
          );
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        const { data: profile } = await this.supabase
          .from('sdk_profiles')
          .select('user_id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (profile) {
          await this.supabase
            .from('sdk_profiles')
            .update({
              api_requests_used: 0,
              updated_at: new Date().toISOString()
            })
            .eq('user_id', profile.user_id);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const failedInvoice = event.data.object as Stripe.Invoice;

        const { data: failedProfile } = await this.supabase
          .from('sdk_profiles')
          .select('user_id')
          .eq('stripe_customer_id', failedInvoice.customer as string)
          .single();

        if (failedProfile) {
          await this.supabase
            .from('sdk_profiles')
            .update({
              subscription_status: 'past_due',
              updated_at: new Date().toISOString()
            })
            .eq('user_id', failedProfile.user_id);

          await this.createNotification(
            failedProfile.user_id,
            'payment_failed',
            'Payment Failed',
            'Your subscription payment could not be processed. Please update your payment method.',
            { invoiceId: failedInvoice.id }
          );
        }
        break;
      }
    }
  }

  private async recordSubscriptionChange(
    userId: string,
    oldTier: string,
    newTier: string,
    reason: string,
    changedBy: string,
    stripeEventId?: string
  ): Promise<void> {
    const id = `sub-history-${Date.now()}`;
    await this.supabase
      .from('subscription_history')
      .insert({
        id,
        user_id: userId,
        old_tier: oldTier,
        new_tier: newTier,
        change_reason: reason,
        changed_by: changedBy,
        stripe_event_id: stripeEventId
      });
  }

  private async createNotification(
    userId: string,
    type: string,
    title: string,
    message: string,
    data?: any
  ): Promise<void> {
    const id = `notif-${Date.now()}`;
    await this.supabase
      .from('subscription_notifications')
      .insert({
        id,
        user_id: userId,
        type,
        title,
        message,
        data: data ? JSON.stringify(data) : null
      });
  }

  async getSubscriptionAnalytics(userId?: string): Promise<any> {
    let subscriptionsQuery = this.supabase
      .from('sdk_profiles')
      .select('subscription_tier, subscription_status, api_requests_used, api_requests_limit');

    if (userId) {
      subscriptionsQuery = subscriptionsQuery.eq('user_id', userId);
    }

    const { data: subscriptions, error } = await subscriptionsQuery;
    if (error) throw error;

    const grouped: Record<string, any> = {};
    (subscriptions || []).forEach((row: any) => {
      const key = `${row.subscription_tier}-${row.subscription_status}`;
      if (!grouped[key]) {
        grouped[key] = {
          subscription_tier: row.subscription_tier,
          subscription_status: row.subscription_status,
          count: 0,
          avg_usage: 0,
          avg_limit: 0
        };
      }
      grouped[key].count += 1;
      grouped[key].avg_usage += Number(row.api_requests_used || 0);
      grouped[key].avg_limit += Number(row.api_requests_limit || 0);
    });

    const subs = Object.values(grouped).map((g: any) => ({
      ...g,
      avg_usage: g.count > 0 ? g.avg_usage / g.count : 0,
      avg_limit: g.count > 0 ? g.avg_limit / g.count : 0
    }));

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let historyQuery = this.supabase
      .from('subscription_history')
      .select('*')
      .gte('created_at', thirtyDaysAgo.toISOString());

    if (userId) {
      historyQuery = historyQuery.eq('user_id', userId);
    }

    const { data: recentChanges, error: rcErr } = await historyQuery;
    if (rcErr) throw rcErr;

    return {
      subscriptions: subs,
      recentChanges: recentChanges || [],
      summary: {
        totalSubscriptions: subs.reduce((sum: number, s: any) => sum + s.count, 0),
        activeSubscriptions: subs
          .filter((s: any) => s.subscription_status === 'active')
          .reduce((sum: number, s: any) => sum + s.count, 0)
      }
    };
  }

  async updateSubscriptionStatuses(): Promise<void> {
    const now = new Date().toISOString();

    const { data: toCancel } = await this.supabase
      .from('sdk_profiles')
      .select('user_id')
      .eq('cancel_at_period_end', true)
      .lte('current_period_end', now);

    for (const sub of (toCancel || [])) {
      await this.supabase
        .from('sdk_profiles')
        .update({
          subscription_status: 'canceled',
          cancel_at_period_end: false,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', sub.user_id);

      await this.createNotification(
        sub.user_id,
        'subscription_canceled',
        'Subscription Canceled',
        'Your subscription has been canceled as requested.'
      );
    }

    const threeDaysLater = new Date();
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);

    const { data: trialsEnding } = await this.supabase
      .from('sdk_profiles')
      .select('user_id, trial_ends_at')
      .eq('subscription_status', 'trialing')
      .lte('trial_ends_at', threeDaysLater.toISOString())
      .gt('trial_ends_at', now);

    for (const trial of (trialsEnding || [])) {
      const daysLeft = Math.ceil(
        (new Date(trial.trial_ends_at).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      );

      await this.createNotification(
        trial.user_id,
        'trial_ending',
        'Trial Ending Soon',
        `Your trial will end in ${daysLeft} day${daysLeft > 1 ? 's' : ''}. Upgrade to continue using premium features.`,
        { daysLeft }
      );
    }
  }
}

export const createSubscriptionService = (supabase: SupabaseClient): SubscriptionService => {
  return new SubscriptionService(supabase);
};
