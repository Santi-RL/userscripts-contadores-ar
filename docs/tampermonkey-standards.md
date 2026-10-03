# Estándares Tampermonkey del proyecto

Estas reglas combinan documentación oficial de Tampermonkey con decisiones de seguridad y rendimiento del repo.

## Metadata obligatoria

- `@version` en `MAJOR.MINOR.PATCH`
- `@homepageURL` y `@supportURL`
- `@updateURL` y `@downloadURL` obligatorios solo si el manifest declara auto-update
- `@downloadURL none` si el manifest declara distribución manual
- `@match` específico
- `@noframes` por defecto
- `@sandbox DOM` cuando no haga falta acceso al contexto JS de la página

## Distribución y actualizaciones

- Un script solo puede autoactualizarse si su `manifest.json` declara `distribution.mode` como `online-auto-update`.
- Los scripts con auto-update deben usar URLs HTTPS públicas y estables. Para GitHub, usar `raw.githubusercontent.com` sobre un repo público.
- No se permiten URLs privadas, temporales, con tokens, credenciales embebidas, query strings de autenticación ni endpoints que requieran cookies o headers especiales.
- En modo `online-auto-update`, `@updateURL` y `@downloadURL` deben coincidir exactamente con `distribution.updateUrl` y `distribution.downloadUrl`.
- En modo `manual`, `@downloadURL` debe ser `none` y `@updateURL` no debe existir.
- Todo script autoactualizable debe seguir aumentando `@version` en cada publicación, porque Tampermonkey usa esa metadata para detectar updates.
- En cada cambio publicado, sincronizar `@version` y `manifest.version` del script modificado. El script principal (`package.json.name`) también debe coincidir con `package.json` y `package-lock.json`; los demás scripts tienen versiones independientes.

## Permisos

- `@grant none` es el default.
- Si el script necesita persistencia o menú, usar solo los grants mínimos requeridos.
- Si necesita red, usar `GM_xmlhttpRequest` solo con `@connect` acotado a hosts explícitos.
- `@connect *` está prohibido.

## Dependencias remotas

- Evitar `@require` externo si no es indispensable.
- Si se usa, debe estar fijado y con hash SRI.
- No encadenar loaders remotos ni código que cambie fuera del control del repo.

## Seguridad de datos

- Nunca publicar PII real, secretos o configuraciones privadas.
- Para datos del usuario, usar configuración local en `GM_setValue`.
- Si un script necesita insumos externos, debe soportar:
  - modo `url` seguro y documentado,
  - modo `file` para importación local.
- No hardcodear hojas publicadas, CSVs privados ni endpoints internos.

## Rendimiento

- `init()` idempotente.
- `destroy()` debe limpiar temporizadores, listeners y observers.
- Evitar polling infinito.
- Los retries deben ser finitos y con límites visibles en constantes.
- Preferir `MutationObserver` acotado a contenedores concretos y con `disconnect()`.
- Evitar observar `document.body` salvo necesidad muy justificada.
- Debounce para actualizaciones de DOM frecuentes.

## Convivencia

- Todo script necesita:
  - `data-tm-script="<id>"` en su contenedor principal,
  - clases `tm-<id>-*`,
  - storage keys `tm.<id>.*`.
- No reutilizar IDs, clases ni storage keys de otro script.
- Si dos scripts comparten target, ambos deben declarar coexistencia y tener prueba dedicada.

## Versionado y publicación

- Los cambios compatibles suman `PATCH` o `MINOR`.
- Los cambios incompatibles o refactors de seguridad pueden subir `MAJOR`.
- La distribución manual es por GitHub Releases con checksum cuando aplique.
- La distribución con auto-update se limita a scripts explícitamente aprobados en el manifest y requiere revisar que el contenido publicado no tenga PII, secretos ni configuraciones privadas.
