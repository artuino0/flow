import { publicRegistrationPlans } from '~/server/utils/registrationIntent'

export default defineCachedEventHandler(async () => ({ plans: await publicRegistrationPlans() }), { maxAge: 30, name: 'public-registration-plans' })
