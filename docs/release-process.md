# Proceso de release

## Objetivo

Publicar versiones auditables. Los scripts con auto-update deben usar URLs publicas estables y subir version en cada publicacion.

## Checklist previo

1. Subir `@version` del userscript en `MAJOR.MINOR.PATCH`.
2. Sincronizar la misma version en `manifest.json` y `package.json`.
3. Revisar cambios del script y su `manifest.json`.
4. Ejecutar:
   - `npm run validate`
   - `npm test`
   - `npm run checksum`
5. Confirmar que no hay datos sensibles en el arbol publico.

## Publicacion

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
2. Confirmar que `@version`, manifest y `package.json` estan sincronizados.
3. Publicar el commit en la rama configurada en las URLs `raw.githubusercontent.com`.
4. Verificar que `distribution.updateUrl` y `distribution.downloadUrl` abren el `*.user.js` publico correcto.
5. Instalar o actualizar desde la URL publica del script.

## Reglas

- No usar assets generados por terceros ni loaders remotos no auditados.
- Mantener el repo como fuente auditable.
- Para scripts con auto-update, GitHub raw publico puede ser canal de instalacion y actualizacion.
- Cada cambio publicado debe subir version. Si la version no cambia, Tampermonkey puede no detectar la actualizacion.
