import { getHeader, readRawBody } from 'h3'
import type Stripe from 'stripe'
import { getStripeClient, syncStripeInvoice, syncStripeSubscription } from '~/server/utils/billing'
import { logger } from '~/server/utils/logger'
import { withAccountRecovery } from '~/server/utils/accountContext'

// Stripe firma el cuerpo crudo. Este endpoint no usa sesión: la firma es la
// autorización y el tenant se resuelve desde metadata o la suscripción previa.
export default defineEventHandler(event => withAccountRecovery(async () => {
  const signature = getHeader(event, 'stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!signature || !secret) throw createError({ statusCode: 400, statusMessage: 'Webhook de Stripe sin firma configurada' })
  const rawBody = await readRawBody(event)
  if (!rawBody) throw createError({ statusCode: 400, statusMessage: 'Webhook de Stripe sin cuerpo' })
  const stripe = getStripeClient()
  let stripeEvent
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Firma de Stripe inválida' })
  }
  try {
    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object
      if (session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(typeof session.subscription === 'string' ? session.subscription : session.subscription.id)
        await syncStripeSubscription(subscription, session.metadata?.tenantId, stripeEvent)
      }
    } else if (stripeEvent.type.startsWith('customer.subscription.')) {
      const snapshot = stripeEvent.data.object as Stripe.Subscription
      // Consultar el estado actual firmado evita aplicar snapshots antiguos.
      // La marca del evento se compara otra vez bajo el candado del tenant.
      const current = await stripe.subscriptions.retrieve(snapshot.id)
      await syncStripeSubscription(current, undefined, stripeEvent)
    } else if (stripeEvent.type.startsWith('invoice.')) {
      await syncStripeInvoice(stripeEvent.data.object as Stripe.Invoice)
    }
  } catch (error) {
    logger.error('stripe_webhook_sync_failed', { eventId: stripeEvent.id, type: stripeEvent.type, errorMessage: error instanceof Error ? error.message : String(error) })
    throw createError({ statusCode: 500, statusMessage: 'No se pudo sincronizar el evento de Stripe' })
  }
  return { received: true }
}))
