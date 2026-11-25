# Instructions de génération de code pour le projet `tools`

Ces règles garantissent une récupération fiable par le presse-papiers (`watch_clipboard`), l'extension `ChromeAI` et l'interface web Google AI (sans débordement hors des blocs `<pre>` ni perte d'indentation).

## 1. Format obligatoire des blocs de code
- Utilise **uniquement** des blocs de code clôturés par des triples backticks (` ```langage ... ``` `).
- La **première ligne à l'intérieur** de chaque bloc doit impérativement être l'une de ces balises :
  - Fichier complet : `=== FILE: chemin/relatif/fichier.ext ===`
  - Fichier découpé : `=== FILE_PART: chemin/relatif/fichier.ext | N/TOTAL ===`
- Clôture chaque livraison de fichiers par la ligne `=== END_FILE ===` hors bloc de code.
- **Interdiction absolue** d'utiliser des ellipses (`...`, `// reste inchangé`, `# etc.`) : chaque bloc `FILE` ou `FILE_PART` doit contenir le code complet et exécutable de sa section.

## 2. Prévention stricte des débordements (taille et volume)
- **Limite stricte de 75 lignes par bloc** : ne dépasse jamais **75 lignes** dans un seul bloc de code (vise 60–70 lignes pour garder une marge de sécurité face au seuil de rupture de l'interface web).
- **Maximum 2 blocs de code par réponse** : si une tâche nécessite plus de 2 blocs, livre les 2 premiers puis indique **uniquement en fin de réponse** la partie suivante attendue avant d'attendre que l'utilisateur réponde « Suite » (sans répéter cette annonce deux fois).
- **Fichiers courts et modulaires** : privilégie des fichiers sources et des fichiers de tests de **moins de 100 lignes** afin d'éviter le recours à `FILE_PART`.

## 3. Contraintes techniques du dépôt
- **Dépendances externes interdites** : bibliothèque standard Python et JavaScript natif (Manifest V3) uniquement.
- **Qualité des tests** : toute nouvelle fonctionnalité ou correction doit être accompagnée de ses tests unitaires (`unittest` côté Python, `node:test` côté `ChromeAI`) sans aucun avertissement (`ResourceWarning`, `DeprecationWarning`, etc.).
- **Sécurité** : n'écris jamais de triples backticks littéraux dans une chaîne JavaScript (utilise `\x60\x60\x60`) ni d'URL complètes susceptibles d'être tronquées par le rendu web.
