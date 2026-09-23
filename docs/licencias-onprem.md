# Activación de Flow on-premise

El paquete SaaS normal (`npm run build`) no necesita licencia local. El paquete
on-premise se construye con `npm run build:onprem`; la comprobación queda
incorporada al paquete y no se desactiva cambiando `APP_MODE` o `.env`.
`APP_MODE=dedicated` sigue configurando el acceso de una sola organización:
no sustituye la activación.

## Una sola vez: preparar el emisor

1. Ejecutar `npm run license:keys`. La clave pública se incorpora a
   `server/utils/licenseIssuerPublicKey.ts`. La privada se crea en
   `.license-issuer/private.pem`, que Git ignora.
2. **Respaldar la clave privada en una bóveda fuera del proyecto.** Jamás
   entregarla junto al paquete. Si se pierde, no se podrán renovar las
   licencias de paquetes ya distribuidos. No volver a generar el par para
   renovar una licencia.
3. Construir el paquete con `npm run build:onprem`. Distribuir solamente el
   artefacto `.output` y los archivos de despliegue necesarios; excluir
   `.license-issuer`, el repositorio y los scripts del emisor.

## Activar una instalación

1. Configurar `FLOWERP_LICENSE_DIR` como directorio persistente y arrancar el
   paquete. Si se ejecuta en un contenedor Linux, montar `/etc/machine-id` **del
   host** como archivo de solo lectura y señalar su ruta con
   `FLOWERP_MACHINE_ID_FILE`. Sin ese montaje, la activación se detiene para
   evitar vincularla al identificador efímero del contenedor.
2. Abrir `/activar` y copiar el código de solicitud.
3. El emisor genera el archivo firmado, por ejemplo:

   ```sh
   npm run license:issue -- --request CODIGO --customer "Mi Cliente" --expires 2027-09-18 --out cliente.license
   ```

   La clave privada puede estar fuera del proyecto mediante
   `FLOWERP_ISSUER_PRIVATE_KEY=/ruta/privada.pem`.
4. El cliente carga `cliente.license` en `/activar`. La app comprueba firma,
   instalación, máquina y vencimiento en el servidor, y habilita el acceso.
   Renovar usa el mismo código y una fecha posterior; se puede cargar otra
   licencia firmada sin reinstalar.

El directorio de licencia contiene el ID de instalación y el archivo firmado.
Debe persistir en reinicios y respaldos. Si se cambia de máquina o se reinstala
el sistema operativo, se emite una licencia nueva para la nueva solicitud. Los
datos de negocio no dependen de ese archivo.

Esta medida impide el traslado simple del paquete y su licencia a otra máquina.
Una clonación completa de una VM puede copiar también su identificador; impedir
ese caso requiere activación en línea o una clave de hardware no exportable.
Además, un cliente con control total del servidor puede modificar el binario
distribuido: ningún control puramente local ofrece protección absoluta.
