# Security Policy

## Alcance

Este proyecto publica un userscript de Tampermonkey para uso manual. El foco de seguridad esta en:

- evitar auto-actualizaciones silenciosas,
- impedir publicacion de datos sensibles,
- limitar permisos y hosts remotos,
- validar compatibilidad y rendimiento antes de cada release.

## Reglas del proyecto

- No publicar credenciales, tokens, cookies, hojas publicadas privadas ni PII real.
- No agregar `@updateURL`.
- Mantener `@downloadURL none`.
- Limitar `@connect` a hosts explicitamente justificados.
- Evitar `@grant` innecesarios.
- No correr smoke tests destructivos sobre produccion.

## Reporte de vulnerabilidades

Si detectas un problema de seguridad:

1. No abras un issue publico con detalles explotables.
2. Contacta al mantenedor por un canal privado.
3. Incluye pasos de reproduccion, impacto y version afectada.

## Versiones soportadas

Solo se soporta la rama principal y la release mas reciente publicada.
