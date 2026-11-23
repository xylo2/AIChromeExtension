# Instructions de génération de code (Compatibilité ChromeAI & `watch_clipboard`)

Lorsque tu génères ou modifies des fichiers dans le dossier `tools` (`ChromeAI`, `watch_clipboard`, `export`, etc.), tu dois **impérativement** respecter les règles de formatage suivantes afin que l'extension navigateur et le script `watch_clipboard` puissent détecter, assembler et écrire automatiquement les fichiers sur le disque.

---

## 1. Balise d'en-tête obligatoire

Chaque fichier doit être placé dans un bloc de code Markdown (trois accents graves) et commencer **dès la toute première ligne à l'intérieur du bloc** par une balise normalisée :

* **Pour un fichier complet (≤ 120 lignes)** :
  `=== FILE: tools/chemin/relatif/du/fichier.py ===`
* **Pour un fichier long (> 120 lignes), découpé en `N` parties** :
  `=== FILE_PART: tools/chemin/relatif/du/fichier.py | 1/3 ===`
  *(puis `2/3`, `3/3`, etc., dans des blocs séparés).*

### Règles strictes sur les chemins
* Utilise uniquement des **chemins relatifs** à la racine du workspace en commençant **toujours par `tools/`** (ex. `tools/watch_clipboard/clipboard_watcher/assembler.py`, `tools/ChromeAI/content.js`, `tools/export/project_exporter/exporter.py`).
* Utilise exclusivement le séparateur `/` (slash).
* **Interdit** : ne commence jamais par `/` ou `\` et n'utilise jamais `..` (les chemins sortant du périmètre sont bloqués par sécurité).

---

## 2. Limite de longueur par bloc (~120 lignes max)

* L'interface web tronque ou fait déborder les blocs de code trop longs.
* **Ne dépasse jamais 120 lignes par bloc de code.**
* Dès qu'un fichier dépasse ~120 lignes, découpe-le systématiquement en plusieurs blocs `FILE_PART` de 80 à 115 lignes chacun.
* Coupe proprement entre deux fonctions, deux méthodes ou deux paragraphes.

---

## 3. Fonctionnement du cache `.watch_clipboard` & intégrité des parties

* **Première génération (alimentation du cache)** : lors de la création d'un fichier ou de sa première modification dans la session, fournis **l'intégralité des parties (`1/N` à `N/N`)** afin d'alimenter le cache miroir `.watch_clipboard` (`fichier.ext.part1`, `.part2`, etc.).
* **Mises à jour suivantes (exploitation du cache)** : une fois que toutes les parties `1..N` d'un fichier long sont déjà en cache et que le nombre total `N` ne change pas, tu peux ne renvoyer **que la ou les parties modifiées** (ex. uniquement la partie `2/4`). `watch_clipboard` réassemblera automatiquement le fichier complet depuis son cache local.
* **Contenu complet de chaque bloc (Zéro ellipse)** : à l'intérieur d'un bloc donné, écris **toujours le code intégral** de ce fichier ou de cette partie.
  * **Strictement interdit** : ne mets jamais de raccourcis du type `# ... reste du code inchangé ...`, `// TODO: garder le reste`, `...`, ni de simples *diffs* (`+` / `-`), car chaque bloc écrase intégralement son fichier cible ou son `.partN`.

---

## 4. Vigilance sur les altérations d'affichage de l'interface web

L'interface de chat filtre ou reformate certaines syntaxes avant affichage, ce qui peut corrompre silencieusement le code généré :

* **Triples backticks à l'intérieur d'un bloc** : écrire littéralement trois accents graves dans une chaîne, une docstring ou un fichier `.md` ferme prématurément le bloc de code Markdown dans l'interface web et fait déborder la suite du fichier hors du bloc.
  * *Parade* : dans le code Python/JS, construis la séquence dynamiquement (`"\x60" * 3` en Python, `"\x60\x60\x60"` en JS). Dans un fichier `.md`, évite d'écrire trois accents graves consécutifs à l'intérieur d'un bloc.
* **URLs et sous-domaines réécrits** : certaines URLs complètes peuvent être tronquées ou normalisées à l'affichage (par exemple un sous-domaine Google transformé en domaine racine ou en lien Markdown).
  * *Parade* : construis dynamiquement les URLs sensibles par concaténation (ex. `"https://" + "contacts." + "google.com"`) et vérifie qu'aucun lien brut n'est altéré.
* **Crochets d'indexation supprimés** : l'interface peut interpréter les index numériques entre crochets comme des marqueurs de citation et les effacer (transformant `match.at(1)` si écrit avec crochets).
  * *Parade* : évite les index numériques entre crochets lorsque c'est critique : préfère `.at(0)` / `.at(1)` en JavaScript, et le déballage (`premier, _ = ...`) ou `next(iter(...))` en Python.
* **Séquences LaTeX / Markdown ambiguës** : évite les combinaisons non échappées de dollar ou antislash susceptibles d'être interprétées en formules mathématiques.

---

## 5. Conventions propres au dossier `tools`

* **Zéro dépendance externe** : les outils Python (`tools/watch_clipboard`, `tools/export`) reposent uniquement sur la bibliothèque standard Python (indiquer `# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)` en première ligne).
* **Typage et sécurité** : utilise les annotations de types Python (`typing`), valide strictement les chemins (`os.path.realpath` / `commonpath`) et préserve l'authentification par jeton (`X-Watcher-Token`) sur les endpoints HTTP locaux.
* **Tests** : tout nouveau comportement ou correctif doit être couvert par les tests unitaires correspondants (`tools/watch_clipboard/tests/`, `tools/export/tests/`, `tools/ChromeAI/tests/extension_logic.test.js`), exécutables via `python tools/watch_clipboard/tools/run_tests_clip.py`.
