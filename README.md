# Userscripts para contadores AR

Scripts para Chrome con la extensión de Tampermonkey para contadores.

## Scripts disponibles

| Script | Para qué sirve | Manual |
| --- | --- | --- |
| ARCA - Login con selector de clientes | Busca clientes por nombre o CUIT y completa el login de clave fiscal. | [Ver manual](userscripts/arca-login-client-selector/README.md) |

## Instalación rápida

1. Instalar la extensión Tampermonkey desde Chrome Web Store.
2. En Chrome, abrir `chrome://extensions`.
3. Activar `Modo de desarrollador`.
4. Abrir los detalles de Tampermonkey.
5. Activar `Permitir secuencias de comandos del usuario`.
6. Entrar al manual del script que quieras usar y seguir sus pasos de instalación.

Esta configuración es necesaria en Chrome para que Tampermonkey pueda ejecutar userscripts.

En Tampermonkey, usar `Importar desde URL` con la URL indicada en el manual del script.

Los scripts instalados desde la URL recomendada pueden autoactualizarse cuando se publique una nueva versión.

## Seguridad

- Los scripts no incluyen datos de clientes.
- Cada usuario configura sus propios datos.

## Ayuda

Para reportar problemas o pedir mejoras, usar los issues del repositorio:

https://github.com/Santi-RL/userscripts-contadores-ar/issues
