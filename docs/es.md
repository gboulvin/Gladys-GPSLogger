# GPSLogger para Gladys Assistant

Esta integración convierte los teléfonos Android con la aplicación libre y
gratuita [GPSLogger](https://gpslogger.app) en rastreadores GPS en Gladys:
posición, distancia a casa, presencia en casa, batería, velocidad. Después
puede reaccionar a las llegadas y salidas en sus escenas y seguir cada
teléfono desde el panel.

## Funcionamiento

GPSLogger llama a una URL cada vez que registra una posición. Gladys ofrece
dos URL:

| URL                           | Cuándo usarla                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| **Local** (`http://…/log`)    | El teléfono alcanza Gladys en la red de casa (Wi-Fi) o mediante una VPN. Nada sale de su casa. |
| **Nube** (URL de Gladys Plus) | El teléfono envía desde cualquier lugar (4G/5G). Requiere una suscripción a Gladys Plus.       |

Puede configurar una, o ambas en dos perfiles de GPSLogger. Cada teléfono
aparece como rastreador en la pestaña **Descubrimiento** de la integración en
cuanto llega su primera posición: haga clic en **Añadir** para crear su
dispositivo.

## 1. Configurar la integración

En Gladys, abra **Integraciones → GPSLogger → Configuración**:

- **Activar el receptor local** (activado por defecto): Gladys publica un
  puerto HTTP en su red para GPSLogger. La URL local exacta aparece en el
  bloque «URL local» de la página (`http://<dirección de Gladys>:<puerto>/log`).
- **Token de acceso** (opcional, recomendado): una cadena aleatoria larga.
  Cada petición debe incluir entonces `token=<valor>`, o la cabecera
  `Authorization: Bearer <valor>`.
- **Radio de la casa**: a qué distancia de la casa se considera que un
  teléfono está en casa (150 m por defecto). La ubicación de la casa es la
  definida en Gladys (**Ajustes → Casas**): Gladys pide acceso a ella al
  instalar la integración. Sin casa ubicada, la distancia y la presencia
  quedan vacías.
- **Umbral de batería baja** y **Rastreador perdido tras**: los usan los
  disparadores de escena descritos abajo.

Para la URL en la nube, pegue su **clave Open API de Gladys Plus** en el
bloque «Webhooks de Gladys Plus». Después pulse **Mostrar las URL de
GPSLogger**: se muestran la URL local, la URL en la nube y los parámetros a
enviar.

## 2. Configurar GPSLogger en el teléfono

1. Instale GPSLogger (F-Droid, GitHub o Google Play).
2. Abra **Logging details → Log to custom URL** y actívelo.
3. **URL**: la URL local o en la nube que muestra Gladys.
4. **HTTP method**: `POST`. **HTTP body**:

   ```
   device=%DEVNAME&lat=%LAT&lon=%LON&acc=%ACC&alt=%ALT&spd=%SPD&dir=%DIR&batt=%BATT&ischarging=%ISCHARGING&time=%TIME&prov=%PROV
   ```

   Añada `&token=SU_TOKEN` si definió un token de acceso. Con el método
   `GET`, añada los mismos parámetros a la URL después de un `?`.

5. **HTTP headers**: `Content-Type: application/x-www-form-urlencoded`.
6. Dé un **nombre de dispositivo** distinto a cada teléfono (**General
   options → Device name**): es el nombre del rastreador en Gladys y su
   identificador. Cambiarlo más tarde crea un nuevo rastreador.
7. Elija el intervalo de registro (**Performance**): cada 1 a 5 minutos es un
   buen equilibrio con la batería.

Un teléfono ya configurado para la integración GPSLogger de Home Assistant
(`latitude=…&longitude=…&device=…`) funciona tal cual: se aceptan ambos
estilos de parámetros.

El botón **Enviar una posición de prueba** de la página de configuración
permite comprobarlo todo sin teléfono.

## 3. Los dispositivos

Cada rastreador expone estas funciones (solo lectura):

| Función          | Unidad | Nota                                                           |
| ---------------- | ------ | -------------------------------------------------------------- |
| Posición         | texto  | «latitud, longitud»                                            |
| Latitud/Longitud | grado  |                                                                |
| En casa          | 0/1    | dentro del radio de la casa (con un margen de salida del 25 %) |
| Distancia a casa | km     |                                                                |
| Precisión        | m      | una posición menos precisa que 1 km nunca cambia «En casa»     |
| Altitud          | m      |                                                                |
| Velocidad        | km/h   | GPSLogger envía m/s, convertidos                               |
| Dirección        | grado  |                                                                |
| Batería          | %      |                                                                |
| Cargando         | 0/1    |                                                                |

La insignia de cada dispositivo indica cómo llegó su última posición:
**local**, **nube**, o **inaccesible** cuando el rastreador está perdido. La
opción «Preferir la conexión local» de la página de configuración no tiene
efecto: es el teléfono quien elige la URL a la que llama.

## 4. Escenas

Disparadores (categoría **Integraciones** del editor de escenas), cada uno con
un filtro opcional por rastreador:

| Disparador                | Cuándo                                                   | Variables                                                                           |
| ------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Posición recibida         | en cada posición                                         | nombre, latitud, longitud, precisión, velocidad, batería, distancia, enlace al mapa |
| Llegada a casa            | el rastreador entra en el radio de la casa               | nombre, latitud, longitud                                                           |
| Salida de casa            | el rastreador sale del radio de la casa                  | nombre, latitud, longitud, distancia                                                |
| Batería del teléfono baja | la batería baja del umbral (una vez por descarga)        | nombre, batería                                                                     |
| Rastreador perdido        | ninguna posición durante el tiempo configurado (una vez) | nombre, minutos desde la última posición                                            |

Acciones:

- **Obtener la posición de un rastreador**: última posición, batería,
  distancia a casa, presencia, minutos desde la actualización y un enlace a
  OpenStreetMap.
- **Distancia entre dos rastreadores**: en km y en m.
- **Distancia a un lugar**: distancia entre un rastreador y unas coordenadas,
  y si está dentro de un radio.

Las tres devuelven `found: false` cuando una posición es desconocida: añada
una condición sobre ello en su escena.

Ejemplo: _cuando «Llegada a casa» para el teléfono de Alicia, si la alarma
está armada, desarmarla y enviar «Bienvenida a casa,
{{triggerEvent.data.device_name}}»_.

## 5. Widgets del panel

- **Rastreadores GPS**: todos los teléfonos de un vistazo (en casa o fuera,
  distancia, batería, última posición); un toque muestra el detalle y un
  enlace a OpenStreetMap.
- **Rastreador GPS**: un teléfono en detalle, con mosaicos en vivo (distancia
  a casa, batería, velocidad), su estado y un botón de mapa. Elija el teléfono
  en los ajustes del widget.

## Privacidad y seguridad

- Las posiciones se guardan solo en su Gladys (los estados de los
  dispositivos, y `trackers.json` en la carpeta de datos de la integración
  para la última posición).
- El receptor local solo acepta posiciones; la integración las valida (token,
  coordenadas). Defina un token de acceso si su red es compartida.
- Mediante Gladys Plus, la propia URL es un secreto: no la comparta. El token
  de acceso añade una segunda comprobación.
- **Olvidar un rastreador** quita un teléfono de la integración (elimine
  también su dispositivo en Gladys).

## Solución de problemas

- **Ningún rastreador en Descubrimiento**: revise el registro de GPSLogger (la
  sección custom URL muestra la respuesta HTTP). `401`: token ausente o
  incorrecto. `400`: falta el nombre del dispositivo o las coordenadas.
- **URL local inaccesible**: el teléfono debe estar en la misma red que Gladys
  (o en una VPN), y la opción «Activar el receptor local» debe estar activada.
- **Falta la URL en la nube**: vincule Gladys Plus en el bloque «Webhooks de
  Gladys Plus» y pulse de nuevo **Mostrar las URL de GPSLogger**.
- **«En casa» queda vacío**: defina la ubicación de su casa en Gladys.
