# Proceso de release

## Objetivo

Publicar versiones auditables. Los scripts con auto-update deben usar URLs públicas estables y subir versión en cada publicación.

## Checklist previo

1. Subir `@version` del userscript en `MAJOR.MINOR.PATCH`.
2. Sincronizar la misma versión en el `manifest.json` del script modificado. Para el script principal, cuyo ID coincide con `package.json.name`, sincronizar también `package.json` y `package-lock.json`. Los demás scripts conservan su versión propia.
3. Revisar cambios del script y su `manifest.json`.
4. Ejecutar:
   - `npm run validate`
   - `npm test`
   - `npm run checksum`
5. Confirmar que no hay datos sensibles en el árbol público.

## Publicación

### Canal manual

1. Crear tag/release en GitHub.
2. Adjuntar:
   - cada `userscripts/<id>/<id>.user.js`
   - `artifacts/SHA256SUMS.txt`
3. Escribir release notes con:
   - scripts afectados,
   - cambios funcionales,
   - cambios de seguridad,
   - compatibilidades rotas si las hubiera.

### Canal online con auto-update

Usar solo cuando `manifest.json` declare `distribution.mode: "online-auto-update"`.

1. Confirmar que el script no contiene PII, secretos, tokens ni datos privados.
2. Confirmar que `@version` y el manifest están sincronizados y que el script principal coincide con `package.json` y `package-lock.json`.
3. Publicar el commit en la rama configurada en las URLs `raw.githubusercontent.com`.
4. Verificar que `distribution.updateUrl` y `distribution.downloadUrl` abren el `*.user.js` público correcto.
5. Instalar o actualizar desde la URL pública del script.

## Reglas

- No usar assets generados por terceros ni loaders remotos no auditados.
- Mantener el repo como fuente auditable.
- Para scripts con auto-update, GitHub raw público puede ser canal de instalación y actualización.
- Cada cambio publicado debe subir versión. Si la versión no cambia, Tampermonkey puede no detectar la actualización.
