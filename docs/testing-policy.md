# Politica de validacion

## Repositorio publico

Esta version publica mantiene el repositorio liviano y no publica fixtures, capturas ni pruebas locales. El material de testing usado durante desarrollo debe quedar fuera de Git, por ejemplo dentro de `private-local/`.

## Validacion incluida

- `npm run validate`: revisa metadata Tampermonkey, manifest, permisos, hosts permitidos y patrones sensibles en archivos publicos.
- `npm test`: ejecuta QA de comportamiento sobre el userscript con DOM y APIs Tampermonkey simuladas, sin datos reales ni red externa.
- `npm run checksum`: genera checksums para adjuntar en releases manuales.

## Reglas para pruebas locales

- Nunca versionar credenciales, storage real, hojas privadas ni datos de clientes.
- Los smoke tests sobre sitios reales deben ser no destructivos y detenerse antes de enviar formularios.
- Las capturas y resultados de pruebas deben permanecer ignorados por Git.
