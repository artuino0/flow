<script setup lang="ts">
definePageMeta({ layout: false })

const { login } = useAuth()

const tenantId = ref('')
const email = ref('')
const password = ref('')
const errorMessage = ref('')
const loading = ref(false)

async function onSubmit() {
  errorMessage.value = ''
  loading.value = true
  try {
    await login(tenantId.value, email.value, password.value)
    await navigateTo('/')
  } catch (err: any) {
    // Credenciales invalidas (401) u otro error de validacion del backend.
    errorMessage.value = err?.data?.statusMessage || err?.data?.message || 'No se pudo iniciar sesion.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 px-4">
    <div class="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h1 class="text-lg font-semibold text-gray-900">ERP Dinamico</h1>
      <p class="mt-1 text-sm text-gray-600">Ingresa tus credenciales para continuar.</p>

      <form class="mt-6 flex flex-col gap-4" @submit.prevent="onSubmit">
        <div>
          <label for="tenantId" class="block text-sm font-medium text-gray-700">Tenant</label>
          <input
            id="tenantId"
            v-model="tenantId"
            type="text"
            required
            placeholder="ID de tu organizacion"
            class="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        <div>
          <label for="email" class="block text-sm font-medium text-gray-700">Correo</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            autocomplete="username"
            class="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        <div>
          <label for="password" class="block text-sm font-medium text-gray-700">Contraseña</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            class="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        <p v-if="errorMessage" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {{ errorMessage }}
        </p>

        <button
          type="submit"
          :disabled="loading"
          class="rounded bg-primary-700 px-3 py-2 text-sm font-medium text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ loading ? 'Ingresando...' : 'Ingresar' }}
        </button>
      </form>
    </div>
  </div>
</template>
