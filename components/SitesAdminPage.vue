<template>
  <section class="sites-admin-page" aria-label="Administración del sitio" tabindex="0"><slot /></section>
</template>
<style scoped>
.sites-admin-page{--list-page-gutter-y:28px;--list-page-gutter-x:28px;box-sizing:border-box;height:100%;min-height:0;min-width:0;width:100%;overflow-y:auto;overflow-x:hidden;padding:28px;background:rgb(var(--brand-bg));color:rgb(var(--brand-text));overscroll-behavior:contain}
.sites-admin-page:focus-visible{outline:2px solid rgb(var(--brand-blue));outline-offset:-2px}
@media(max-width:720px){.sites-admin-page{--list-page-gutter-y:16px;--list-page-gutter-x:16px;padding:16px}}
</style>
