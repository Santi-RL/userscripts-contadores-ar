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

Al abrir el login de ARCA aparece un selector de clientes.

Tenés dos formas de cargar datos:

- `Google Sheets`: pega el link de una hoja pública o visible para cualquiera con el enlace.
- `Importar CSV`: selecciona un archivo CSV desde tu computadora.

Después podés buscar por nombre, razón social o CUIT. Al elegir un cliente, el script completa el campo de CUIT/CUIL del login.

El archivo de datos solo debe tener nombres y CUIT/CUIL. No debe incluir contraseñas.

El funcionamiento esperado es: este script completa el CUIT/CUIL y las contraseñas las maneja Chrome, si el usuario las guarda en el administrador de contraseñas de Google.

## Google Sheets

La hoja debe ser visible para cualquiera con el enlace. El script la descarga como CSV de forma anonima.

Usa esta opción si trabajás en equipo y querés que todos tengan la lista actualizada.

Al abrir el login, el script intenta actualizar la lista. El botón `Recargar` fuerza una nueva descarga.

Importante: cualquier persona con el link podría ver la hoja. No pongas contraseñas, claves fiscales, notas privadas ni datos sensibles.

## CSV local

Usa esta opción si no querés compartir una planilla por link.

Cuando actualices el archivo, usa `Recargar` o `Importar CSV` y vuelve a elegir el archivo actualizado. Chrome no permite que el script lea automáticamente un archivo local sin que lo selecciones otra vez.

## Formato CSV

Formato recomendado:

```csv
Nombre,Apellido,CUIT
Maria,Perez,XX-XXXXXXXX-X
```

También acepta:

- columnas extra no usadas, por ejemplo `Record ID`
- `Nombre completo`
- `Razon Social`
- `Cliente`
- `CUIL`
- separador con coma `,`
- separador con punto y coma `;`

Si usas Excel, guarda la planilla como CSV.

No agregues columnas de contraseñas. El script no las lee ni las necesita.

## Borrar datos

El botón `Borrar datos` elimina la configuración, cache y clientes guardados por este script en Tampermonkey.

## Problemas comunes

- No aparece el selector: revisa que Tampermonkey este activo y que en Chrome este habilitado `Permitir secuencias de comandos del usuario`.
- Google Sheets no carga: revisa que la hoja sea pública o visible para cualquiera con el enlace.
- El CSV no carga: revisa que la fila 1 tenga los encabezados necesarios `Nombre`, `Apellido` y `CUIT`.
- El sitio de ARCA cambio: abre un issue en GitHub.

## Privacidad

El script no envía datos a servidores propios ni tiene analytics. Solo lee la fuente que vos configures: Google Sheets público o CSV local. No guarda ni completa contraseñas.
