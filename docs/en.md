# GPSLogger for Gladys Assistant

This integration turns Android phones running the free, open-source
[GPSLogger](https://gpslogger.app) app into GPS trackers in Gladys: position,
distance from home, home presence, battery, speed. You can then react to
arrivals and departures in your scenes and follow every phone from the
dashboard.

## How it works

GPSLogger calls a URL each time it logs a position. Gladys offers two URLs:

| URL                         | When to use it                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| **Local** (`http://…/log`)  | The phone reaches Gladys on your home network (Wi-Fi) or through a VPN. Nothing leaves your home. |
| **Cloud** (Gladys Plus URL) | The phone logs from anywhere (4G/5G). Requires a Gladys Plus subscription.                        |

You can configure one of them, or both in two GPSLogger profiles. Each phone
becomes a tracker in the **Discovery** tab of the integration as soon as its
first position arrives: click **Add** to create its device.

## 1. Configure the integration

In Gladys, open **Integrations → GPSLogger → Configuration**:

- **Enable the local receiver** (on by default): Gladys publishes an HTTP port
  on your network for GPSLogger. The exact local URL is written in the
  "Local URL" block of the page (`http://<gladys address>:<port>/log`).
- **Access token** (optional, recommended): a long random string. Every
  request must then carry `token=<value>`, or the `Authorization: Bearer
<value>` header.
- **Home radius**: how close to the house location a phone must be to be at
  home (150 m by default). The house location is the one set in Gladys
  (**Settings → Houses**): Gladys asks for access to it when you install the
  integration. Without a located house, distance and presence stay empty.
- **Low battery threshold** and **Tracker lost after**: used by the scene
  triggers below.

For the cloud URL, paste your **Gladys Plus Open API key** in the "Gladys Plus
webhooks" block. Then press **Show the GPSLogger URLs**: it shows the local URL,
the cloud URL and the parameters to send.

## 2. Configure GPSLogger on the phone

1. Install GPSLogger (F-Droid, GitHub or Google Play).
2. Open **Logging details → Log to custom URL**, and enable it.
3. **URL**: the local or cloud URL shown by Gladys.
4. **HTTP method**: `POST`. **HTTP body**:

   ```
   device=%DEVNAME&lat=%LAT&lon=%LON&acc=%ACC&alt=%ALT&spd=%SPD&dir=%DIR&batt=%BATT&ischarging=%ISCHARGING&time=%TIME&prov=%PROV
   ```

   Add `&token=YOUR_TOKEN` if you set an access token. With the `GET` method,
   append the same parameters to the URL after a `?`.

5. **HTTP headers**: `Content-Type: application/x-www-form-urlencoded`.
6. Set a distinct **device name** on each phone (**General options → Device
   name**): it is the name of the tracker in Gladys, and its identifier.
   Changing it later creates a new tracker.
7. Choose the logging interval (**Performance**): every 1 to 5 minutes is a
   good balance with the battery.

A phone already configured for the Home Assistant GPSLogger integration
(`latitude=…&longitude=…&device=…`) works as is: both parameter styles are
accepted.

Use the **Send a test position** button of the Configuration page to check
everything without a phone.

## 3. The devices

Each tracker exposes these features (read-only):

| Feature            | Unit   | Note                                                      |
| ------------------ | ------ | --------------------------------------------------------- |
| Position           | text   | "latitude, longitude"                                     |
| Latitude/Longitude | degree |                                                           |
| At home            | 0/1    | inside the home radius (with a 25 % exit margin)          |
| Distance from home | km     |                                                           |
| Accuracy           | m      | a position less precise than 1 km never changes "At home" |
| Altitude           | m      |                                                           |
| Speed              | km/h   | GPSLogger sends m/s, converted                            |
| Direction          | degree |                                                           |
| Battery            | %      |                                                           |
| Charging           | 0/1    |                                                           |

The badge of each device tells how its last position arrived: **local**,
**cloud**, or **unreachable** once the tracker is lost. The "Prefer the local
connection" toggle of the Configuration page has no effect: the phone decides
which URL it calls.

## 4. Scenes

Triggers (category **Integrations** of the scene editor), each with an
optional tracker filter:

| Trigger           | When                                                       | Variables                                                               |
| ----------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| Position received | every position                                             | name, latitude, longitude, accuracy, speed, battery, distance, map link |
| Arrived home      | the tracker enters the home radius                         | name, latitude, longitude                                               |
| Left home         | the tracker leaves the home radius                         | name, latitude, longitude, distance                                     |
| Phone battery low | the battery drops below the threshold (once per discharge) | name, battery                                                           |
| Tracker lost      | no position for the configured delay (once)                | name, minutes since the last position                                   |

Actions:

- **Get a tracker position**: last position, battery, distance from home,
  at home, minutes since the update and an OpenStreetMap link.
- **Distance between two trackers**: in km and m.
- **Distance to a place**: distance between a tracker and coordinates, and
  whether it is within a radius.

All three return `found: false` when a position is unknown: use a condition on
it in your scene.

Example: _when "Arrived home" for Alice's phone, if the alarm is armed, disarm
it and send "Welcome home, {{triggerEvent.data.device_name}}"_.

## 5. Dashboard widgets

- **GPS trackers**: every phone at a glance (home or away, distance, battery,
  last update); a tap shows the details and an OpenStreetMap link.
- **GPS tracker**: one phone in detail, with live tiles (distance from home,
  battery, speed), its status and a map button. Pick the phone in the widget
  settings.

## Privacy and security

- Positions are stored only in your Gladys (the device states, and
  `trackers.json` in the integration data folder for the last position).
- The local receiver only accepts positions; the integration validates them
  (token, coordinates). Set an access token if your network is shared.
- Through Gladys Plus, the URL itself is a secret: do not share it. The
  access token adds a second check.
- **Forget a tracker** removes a phone from the integration (delete its device
  in Gladys too).

## Troubleshooting

- **No tracker in Discovery**: check the GPSLogger log (the custom URL
  section shows the HTTP answer). `401`: wrong or missing token. `400`: the
  device name or the coordinates are missing.
- **Local URL unreachable**: the phone must be on the same network as Gladys
  (or on a VPN), and the "Enable the local receiver" option must be on.
- **Cloud URL missing**: link Gladys Plus in the "Gladys Plus webhooks" block,
  then press **Show the GPSLogger URLs** again.
- **"At home" stays empty**: set the location of your house in Gladys.
