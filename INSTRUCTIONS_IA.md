# Instructions de génération de code (ChromeAI & `watch_clipboard`)

Lorsque tu génères ou modifies des fichiers dans `tools` (`ChromeAI`, `watch_clipboard`, `export`), applique **impérativement** ces règles pour garantir un assemblage sans troncature ni erreur de parseur.

## 1. Règles critiques d'intégrité (Priorité maximale)

* **Format des blocs** : place la balise en toute première ligne **à l'intérieur** du bloc de code, uniquement avec des chemins relatifs commençant par `tools/` (sans `/` initial ni `..`).
  * Fichier complet (`<= 90` lignes) : `=== FILE: tools/chemin/relatif/fichier.py ===`
  * Fichier long (`> 90` lignes) : `=== FILE_PART: tools/chemin/relatif/fichier.py | 1/N ===`
* **Stabilité de `N` & découpage** : calcule `N` avant d'écrire `1/N` et ne le modifie jamais en cours de livraison. Vise 70 à 90 lignes par bloc (`<= 95` caractères par ligne) en coupant proprement entre deux fonctions ou méthodes. Maximum **2 à 3 blocs `FILE_PART`** par réponse.
* **Code 100 % complet (Zéro ellipse)** : écris toujours l'intégralité du bloc. Sont strictement interdits : `# ... reste du code inchangé ...`, `// TODO`, `...`, ou de simples *diffs*.
* **Séparateur obligatoire après le code & signalement de suite** : si tu ajoutes une explication ou une action manuelle après les blocs de code, place **impérativement** la balise `=== END_FILE ===` sur une ligne seule avant ton texte afin de délimiter la fin du code. Si d'autres parties restent à livrer, annonce-le en une ligne avant le premier bloc (`Livraison en cours : tape « Suite » pour recevoir les blocs restants.`).

### Exemple de sortie attendue
Livraison en cours : tape « Suite » pour recevoir les blocs restants.
~~~python
