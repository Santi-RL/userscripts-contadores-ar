# ARCA - Login con selector de clientes

Agrega un buscador de clientes al login de ARCA para completar el CUIT/CUIL sin tipearlo manualmente.

## Instalación

1. Instalar Tampermonkey en Chrome.
2. En Chrome, abrir `chrome://extensions`.
3. Activar `Modo de desarrollador`.
4. Entrar en los detalles de Tampermonkey.
5. Activar `Permitir secuencias de comandos del usuario`.
6. Abrir Tampermonkey.
7. En `Importar desde URL`, pegar esta URL:

```text
https://raw.githubusercontent.com/Santi-RL/userscripts-contadores-ar/main/userscripts/arca-login-client-selector/arca-login-client-selector.user.js
```

8. Presionar `Instalar`.
9. Tampermonkey va a mostrar la pantalla de instalación. Presionar `Instalar`.
10. Entrar al login de ARCA.

## Actualizaciones

Si instalaste el script con la URL anterior, Tampermonkey puede actualizarlo automáticamente cuando se publique una nueva versión.

Si lo instalaste importando un archivo descargado, conviene reinstalarlo una vez usando `Importar desde URL` para recibir actualizaciones.

Los datos de clientes quedan guardados en Tampermonkey y normalmente se conservan al reinstalar una versión nueva del mismo script.

## Uso

Versión actual: **1.0.7**.

Al abrir el login de ARCA aparece un selector de clientes.

Tenés dos formas de cargar datos:

- `Google Sheets`: pega el link de una hoja pública o visible para cualquiera con el enlace.
- `Importar CSV`: selecciona un archivo CSV desde tu computadora.

Después podés buscar por nombre, razón social o CUIT. Al elegir un cliente, el script completa el campo de CUIT/CUIL del login.

El selector muestra hasta 100 clientes a la vez. La búsqueda incluye toda la lista: si hay más coincidencias, refiná el nombre o el CUIT para encontrar al cliente que necesitás. El último cliente seleccionado se conserva al volver a abrir el login.

El archivo de datos solo debe tener nombres y CUIT/CUIL. No debe incluir contraseñas.

El funcionamiento esperado es: este script completa el CUIT/CUIL y las contraseñas las maneja Chrome, si el usuario las guarda en el administrador de contraseñas de Google.

## Google Sheets

La hoja debe ser visible para cualquiera con el enlace. El script la descarga como CSV de forma anónima.

Usá esta opción si trabajás en equipo y querés que todos tengan la lista actualizada.

Al abrir el login, el script muestra inmediatamente la lista guardada. Si pasaron **24 horas desde la última descarga correcta**, intenta actualizarla. El botón `Recargar` fuerza una nueva descarga en cualquier momento, aunque la lista todavía esté vigente.

La fecha de la última actualización aparece debajo del selector. Si Google no responde, podés seguir usando la lista anterior y el script muestra un aviso. El plazo de 24 horas se comprueba al abrir el login: no hay consultas periódicas en segundo plano ni sincronización con el navegador cerrado.

Si escribís un CUIT manualmente mientras se actualiza la lista, la respuesta no reemplaza lo que escribiste. También se admiten enlaces de hojas publicadas que terminan en `pub` o `pubhtml`.

Si HubSpot o n8n agregan una fila, aparece en la siguiente descarga correcta. Para usar un cliente recién agregado sin esperar al día siguiente, abrí los controles y presioná `Recargar`. Las columnas `Nombre`, `Apellido` y `CUIT` se leen de la pestaña indicada por el `gid` del enlace; `Record ID` y las demás columnas se ignoran.

Importante: cualquier persona con el link podría ver la hoja. No pongas contraseñas, claves fiscales, notas privadas ni datos sensibles.

Aunque no incluya contraseñas, una hoja visible por enlace expone los nombres y CUIT a quien lo tenga. Si necesitás mantener esos datos privados, usá el modo CSV local; esta versión no descarga hojas que requieran iniciar sesión en Google.

## CSV local

Usá esta opción si no querés compartir una planilla por link.

Cuando actualices el archivo, usa `Recargar` o `Importar CSV` y vuelve a elegir el archivo actualizado. Chrome no permite que el script lea automáticamente un archivo local sin que lo selecciones otra vez.

## Formato CSV

Formato recomendado:

```csv
Nombre,Apellido,CUIT
María,Pérez,XX-XXXXXXXX-X
```

También acepta:

- columnas extra no usadas, por ejemplo `Record ID`
- `Nombre completo`
- `Razón Social`
- `Cliente`
- `CUIL`
- separador con coma `,`
- separador con punto y coma `;`

Si usas Excel, guarda la planilla como CSV.

No agregues columnas de contraseñas. El script no las lee ni las necesita.

## Borrar datos

El botón `Borrar datos` elimina la configuración, caché y clientes guardados por este script en Tampermonkey. También invalida las descargas y lecturas de archivos pendientes para evitar que vuelvan a guardar los datos borrados. Importar un CSV cancela cualquier descarga anterior.

Las lecturas de archivos locales se pueden cancelar: borrar los datos, cambiar de fuente o salir de la página detiene la lectura que esté en curso.

## Rendimiento

El script solo se ejecuta en las URLs del login de ARCA/AFIP declaradas en su metadata. No usa consultas continuas ni observadores permanentes del DOM. Reutiliza los datos en memoria durante la búsqueda, limita las opciones visibles a 100 y espera 120 ms después de la última tecla antes de filtrar.

Al salir de la página, cancela las solicitudes pendientes, limpia los temporizadores y libera los nodos y listeners de la interfaz. Si el navegador restaura el login al volver con `Atrás`, reconstruye el selector.

Estas medidas reducen el trabajo del selector, pero no establecen un consumo fijo de RAM para Chrome o Tampermonkey.

## Problemas comunes

- No aparece el selector: revisa que Tampermonkey esté activo y que en Chrome esté habilitado `Permitir secuencias de comandos del usuario`.
- Google Sheets no carga: revisa que la hoja sea pública o visible para cualquiera con el enlace.
- El CSV no carga: revisa que la fila 1 tenga los encabezados necesarios `Nombre`, `Apellido` y `CUIT`.
- El sitio de ARCA cambió: abre un issue en GitHub.

## Privacidad

El script no envía datos a servidores propios ni tiene analytics. Solo lee la fuente que vos configures: Google Sheets público o CSV local. No guarda ni completa contraseñas.
