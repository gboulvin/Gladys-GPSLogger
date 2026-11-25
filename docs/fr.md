# GPSLogger pour Gladys Assistant

Cette intégration transforme les téléphones Android équipés de l'application
libre et gratuite [GPSLogger](https://gpslogger.app) en traceurs GPS dans
Gladys : position, distance du domicile, présence à la maison, batterie,
vitesse. Vous pouvez ensuite réagir aux arrivées et aux départs dans vos scènes
et suivre chaque téléphone depuis le tableau de bord.

## Fonctionnement

GPSLogger appelle une URL à chaque position enregistrée. Gladys propose deux
URL :

| URL                         | Quand l'utiliser                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Locale** (`http://…/log`) | Le téléphone joint Gladys sur le réseau de la maison (Wi-Fi) ou via un VPN. Rien ne sort de chez vous. |
| **Cloud** (URL Gladys Plus) | Le téléphone envoie ses positions de partout (4G/5G). Nécessite un abonnement Gladys Plus.             |

Vous pouvez en configurer une, ou les deux dans deux profils GPSLogger. Chaque
téléphone apparaît comme traceur dans l'onglet **Découverte** de l'intégration
dès sa première position : cliquez sur **Ajouter** pour créer son appareil.

## 1. Configurer l'intégration

Dans Gladys, ouvrez **Intégrations → GPSLogger → Configuration** :

- **Activer le récepteur local** (activé par défaut) : Gladys publie un port
  HTTP sur votre réseau pour GPSLogger. L'URL locale exacte est écrite dans le
  bloc « URL locale » de la page (`http://<adresse de Gladys>:<port>/log`).
- **Jeton d'accès** (facultatif, recommandé) : une longue chaîne aléatoire.
  Chaque requête doit alors contenir `token=<valeur>`, ou l'en-tête
  `Authorization: Bearer <valeur>`.
- **Rayon du domicile** : à quelle distance de la maison un téléphone est
  considéré à la maison (150 m par défaut). La position de la maison est celle
  définie dans Gladys (**Paramètres → Maisons**) : Gladys demande l'accès à
  cette position à l'installation de l'intégration. Sans maison localisée, la
  distance et la présence restent vides.
- **Seuil de batterie faible** et **Traceur perdu après** : utilisés par les
  déclencheurs de scène ci-dessous.

Pour l'URL cloud, collez votre **clé Open API Gladys Plus** dans le bloc
« Webhooks Gladys Plus ». Cliquez ensuite sur **Afficher les URL GPSLogger** :
l'URL locale, l'URL cloud et les paramètres à envoyer s'affichent.

## 2. Configurer GPSLogger sur le téléphone

1. Installez GPSLogger (F-Droid, GitHub ou Google Play).
2. Ouvrez **Logging details → Log to custom URL** et activez-le.
3. **URL** : l'URL locale ou cloud affichée par Gladys.
4. **HTTP method** : `POST`. **HTTP body** :

   ```
   device=%DEVNAME&lat=%LAT&lon=%LON&acc=%ACC&alt=%ALT&spd=%SPD&dir=%DIR&batt=%BATT&ischarging=%ISCHARGING&time=%TIME&prov=%PROV
   ```

   Ajoutez `&token=VOTRE_JETON` si vous avez défini un jeton d'accès. Avec la
   méthode `GET`, ajoutez les mêmes paramètres à l'URL après un `?`.

5. **HTTP headers** : `Content-Type: application/x-www-form-urlencoded`.
6. Donnez un **nom d'appareil** différent à chaque téléphone (**General
   options → Device name**) : c'est le nom du traceur dans Gladys, et son
   identifiant. Le changer plus tard crée un nouveau traceur.
7. Choisissez l'intervalle d'enregistrement (**Performance**) : toutes les 1 à
   5 minutes est un bon compromis avec la batterie.

Un téléphone déjà configuré pour l'intégration GPSLogger de Home Assistant
(`latitude=…&longitude=…&device=…`) fonctionne tel quel : les deux styles de
paramètres sont acceptés.

Le bouton **Envoyer une position de test** de la page de configuration permet
de tout vérifier sans téléphone.

## 3. Les appareils

Chaque traceur expose ces fonctionnalités (lecture seule) :

| Fonctionnalité       | Unité | Remarque                                                             |
| -------------------- | ----- | -------------------------------------------------------------------- |
| Position             | texte | « latitude, longitude »                                              |
| Latitude/Longitude   | degré |                                                                      |
| À la maison          | 0/1   | dans le rayon du domicile (avec une marge de sortie de 25 %)         |
| Distance du domicile | km    |                                                                      |
| Précision            | m     | une position moins précise que 1 km ne change jamais « À la maison » |
| Altitude             | m     |                                                                      |
| Vitesse              | km/h  | GPSLogger envoie des m/s, convertis                                  |
| Direction            | degré |                                                                      |
| Batterie             | %     |                                                                      |
| En charge            | 0/1   |                                                                      |

Le badge de chaque appareil indique par où est arrivée sa dernière position :
**local**, **cloud**, ou **injoignable** quand le traceur est perdu.
L'option « Privilégier la connexion locale » de la page de configuration n'a
pas d'effet : c'est le téléphone qui choisit l'URL qu'il appelle.

## 4. Scènes

Déclencheurs (catégorie **Intégrations** de l'éditeur de scènes), chacun avec
un filtre facultatif sur le traceur :

| Déclencheur                  | Quand                                                   | Variables                                                                    |
| ---------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Position reçue               | à chaque position                                       | nom, latitude, longitude, précision, vitesse, batterie, distance, lien carte |
| Arrivée à la maison          | le traceur entre dans le rayon du domicile              | nom, latitude, longitude                                                     |
| Départ de la maison          | le traceur sort du rayon du domicile                    | nom, latitude, longitude, distance                                           |
| Batterie du téléphone faible | la batterie passe sous le seuil (une fois par décharge) | nom, batterie                                                                |
| Traceur perdu                | aucune position depuis le délai configuré (une fois)    | nom, minutes depuis la dernière position                                     |

Actions :

- **Lire la position d'un traceur** : dernière position, batterie, distance
  du domicile, présence, minutes depuis la mise à jour et un lien
  OpenStreetMap.
- **Distance entre deux traceurs** : en km et en m.
- **Distance jusqu'à un lieu** : distance entre un traceur et des
  coordonnées, et s'il est dans un rayon donné.

Les trois renvoient `found: false` quand une position est inconnue : ajoutez
une condition dessus dans votre scène.

Exemple : _quand « Arrivée à la maison » pour le téléphone d'Alice, si
l'alarme est armée, la désarmer et envoyer « Bon retour,
{{triggerEvent.data.device_name}} »_.

## 5. Widgets du tableau de bord

- **Traceurs GPS** : tous les téléphones d'un coup d'œil (maison ou absent,
  distance, batterie, dernière mise à jour) ; un appui affiche le détail et un
  lien OpenStreetMap.
- **Traceur GPS** : un téléphone en détail, avec des tuiles en direct
  (distance du domicile, batterie, vitesse), son état et un bouton carte.
  Choisissez le téléphone dans les paramètres du widget.

## Vie privée et sécurité

- Les positions sont stockées uniquement dans votre Gladys (les états des
  appareils, et `trackers.json` dans le dossier de données de l'intégration
  pour la dernière position).
- Le récepteur local n'accepte que des positions ; l'intégration les valide
  (jeton, coordonnées). Définissez un jeton d'accès si votre réseau est
  partagé.
- Via Gladys Plus, l'URL elle-même est un secret : ne la partagez pas. Le
  jeton d'accès ajoute une seconde vérification.
- **Oublier un traceur** retire un téléphone de l'intégration (supprimez aussi
  son appareil dans Gladys).

## Dépannage

- **Aucun traceur dans Découverte** : consultez le journal de GPSLogger (la
  section custom URL affiche la réponse HTTP). `401` : jeton absent ou
  incorrect. `400` : le nom de l'appareil ou les coordonnées manquent.
- **URL locale injoignable** : le téléphone doit être sur le même réseau que
  Gladys (ou sur un VPN), et l'option « Activer le récepteur local » doit être
  activée.
- **URL cloud absente** : liez Gladys Plus dans le bloc « Webhooks Gladys
  Plus », puis cliquez à nouveau sur **Afficher les URL GPSLogger**.
- **« À la maison » reste vide** : définissez la position de votre maison dans
  Gladys.
