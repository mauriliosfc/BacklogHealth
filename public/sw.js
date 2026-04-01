// Service Worker mínimo — habilita instalação como PWA
// Não faz cache para garantir dados sempre atualizados do Azure DevOps
self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});
