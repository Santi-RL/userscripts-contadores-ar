# Política de validación

## Repositorio público

Esta versión pública mantiene el repositorio liviano y no publica fixtures, capturas ni pruebas locales. El material de testing usado durante desarrollo debe quedar fuera de Git, por ejemplo dentro de `private-local/`.

## Validación incluida

- `npm run validate`: revisa metadata Tampermonkey, manifest, permisos, hosts permitidos y patrones sensibles en archivos públicos.
- `npm test`: ejecuta QA de comportamiento sobre el userscript con DOM y APIs Tampermonkey simuladas, sin datos reales ni red externa.
- `npm run checksum`: genera checksums para adjuntar en releases manuales.

## Reglas para pruebas locales

- Nunca versionar credenciales, storage real, hojas privadas ni datos de clientes.
- Los smoke tests sobre sitios reales deben ser no destructivos y detenerse antes de enviar formularios.
- Las capturas y resultados de pruebas deben permanecer ignorados por Git.

## Selector de clientes de ARCA

La QA de comportamiento debe comprobar la actualización al vencer las 24 horas, la recarga manual, la disponibilidad inmediata de la caché, la conservación de la selección y la búsqueda fuera del límite de 100 resultados visibles. También debe cubrir el borrado y los cambios de fuente durante una solicitud o lectura de archivo pendiente, los errores de solicitudes antiguas y la restauración de la interfaz tras `pagehide`/`pageshow`.

Para pruebas en el navegador interno, se puede cargar el script canónico con APIs Tampermonkey simuladas en un formulario local. Una planilla real autorizada solo se descarga mediante lectura; sus datos y cualquier configuración que la identifique permanecen en `private-local/`. En el login oficial se usan únicamente registros sintéticos y se detiene la prueba antes de enviar el formulario. Estas pruebas verifican el script y el DOM; la simulación no sustituye una prueba de instalación en la extensión Tampermonkey.
