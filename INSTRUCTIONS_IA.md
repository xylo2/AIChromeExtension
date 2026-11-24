# Instructions de génération de code (ChromeAI & `watch_clipboard`)

Lorsque tu génères ou modifies des fichiers dans le dossier `tools` (`ChromeAI`, `watch_clipboard`, `export`), respecte **impérativement** ces règles afin que l'extension navigateur et `watch_clipboard` assemblent les fichiers sans troncature ni blocage.

---

## 0. Style de communication & collaboration

* **Concision stricte** : pas d'explications détaillées ni de théorie superflue ; va directement au code ou au diagnostic court.
* **Actions utilisateur** : indique explicitement quand une action manuelle accélère la validation (ex. : exécuter `python tools/watch_clipboard/tools/run_tests_clip.py`, recharger l'extension dans `chrome://extensions`, ou coller une trace brute).
* **Relecture systématique des `git diff`** : lorsqu'un `git diff` est fourni en contexte, relis-le systématiquement afin de détecter toute incohérence ou régression (code supprimé par erreur, options CLI, dépendances, règles de filtrage, tests supprimés, ou **URLs / sous-domaines réécrits ou tronqués à tort**) avant de valider un commit.

---

## 1. Balise d'en-tête & stabilité du découpage

* **Placement obligatoire** : la balise `=== FILE: ... ===` ou `=== FILE_PART: ... ===` doit toujours être placée **à l'intérieur** du bloc de code (en première ligne juste après les trois accents graves), jamais à l'extérieur.
* **Fichier complet (≤ 110 lignes)** :
  `=== FILE: tools/chemin/relatif/du/fichier.py ===`
* **Fichier long (> 110 lignes), découpé en `N` parties** :
  `=== FILE_PART: tools/chemin/relatif/du/fichier.py | 1/3 ===`

### Règles strictes
* Utilise uniquement des **chemins relatifs** commençant par `tools/` avec `/`. Jamais de `/` initial ni de `..`.
* **Stabilité de `N`** : calcule `N` **avant** d'écrire la partie `1/N`. Ne change jamais `N` en cours de livraison.
* **Zéro note après un bloc** : n'écris jamais de commentaire ou parenthèse juste sous la fermeture d'un bloc de code.

---

## 2. Limites anti-virtualisation & anti-blocage

* **≤ 110 lignes par bloc** (viser 70 à 105 lignes par `FILE_PART`) et lignes concises (≤ 95 caractères lorsque possible).
* **Maximum 2 à 3 blocs `FILE_PART` par réponse** pour éviter tout coupe-circuit du générateur.
* Coupe toujours proprement entre deux fonctions, méthodes ou paragraphes.

---

## 3. Cache `.watch_clipboard` & intégrité (Zéro ellipse)

* **Première génération** : fournis **toutes les parties (`1/N` à `N/N`)** d'un fichier créé ou modifié pour alimenter le cache `.watch_clipboard`.
* **Mises à jour suivantes** : renvoie uniquement la ou les parties modifiées si `N` reste identique.
* **Contenu complet (Zéro ellipse)** : écris **toujours le code intégral** de chaque bloc.
  * **Strictement interdit** : `# ... reste du code inchangé ...`, `// TODO: garder le reste`, `...`, ou de simples *diffs* (`+` / `-`).

---

## 4. Vigilance sur les altérations d'affichage de l'interface web

* **Triples backticks à l'intérieur d'un bloc** : écrire trois accents graves littéraux ferme prématurément le bloc Markdown et fait déborder la suite hors du bloc.
  * *Parade* : construis la séquence par code ASCII (`chr(96) * 3` en Python, `String.fromCharCode(96).repeat(3)` en JS) plutôt qu'en littéral ou échappement hexadécimal.
* **Liens Markdown et URLs dans le code** :
  * En Markdown (`.md`), utilise un lien explicite `[Nom du service](https://domaine.tld)` sans backticks ni crochets imbriqués dans le libellé.
  * Dans le code (`.py` / `.js`), ne mets jamais d'URL littérale contenant un sous-domaine dans une chaîne statique ; construis-la dynamiquement par concaténation de segments neutres (`"https" + "://" + "www." + "google" + ".com"`). Les URLs tronquées sont automatiquement réparées via `tools/watch_clipboard/tools/fix_urls.py`.
* **Crochets d'indexation supprimés** : l'interface peut supprimer les index numériques entre crochets comme citations -> utilise `.at(0)` / `.at(1)` en JS, et le déballage (`a, b = pair`) ou `next(iter(...))` en Python.
* **Séquences LaTeX / Markdown ambiguës** : évite les combinaisons non échappées de dollar ou antislash.

---

## 5. Confidentialité & identifiants abstraits

* **Interdiction stricte** : aucun nom réel, prénom réel, téléphone, e-mail, chemin nominatif ou identifiant réel dans le code, les commentaires, les tests ou la documentation.
* **Identifiants abstraits recommandés** : utilise uniquement des libellés neutres (`Utilisateur_A`, `Entree_Test_1`, `06 00 00 00 01`, `test1@exemple.invalid`, `Dossier_Test_2026`).

---

## 6. Conventions propres au dossier `tools`

* **Zéro dépendance externe** : les outils Python (`tools/watch_clipboard`, `tools/export`) reposent uniquement sur la bibliothèque standard Python (`# Commandes pip à exécuter : Aucune dépendance externe requise (bibliothèque standard uniquement)` en première ligne).
* **Typage et sécurité** : annote avec `typing`, valide strictement les chemins (`os.path.realpath` / `commonpath`) et préserve l'authentification par jeton (`X-Watcher-Token`) sur les endpoints HTTP locaux.
* **Tests, warnings & modularité** : tout nouveau comportement ou correctif doit être couvert par les tests unitaires modulaires (`tools/watch_clipboard/tests/`, `tools/export/tests/`, `tools/ChromeAI/tests/*.test.js`), exécutables via `python tools/watch_clipboard/tools/run_tests_clip.py` (warnings Python activés en mode `default` et traités comme anomalies).
