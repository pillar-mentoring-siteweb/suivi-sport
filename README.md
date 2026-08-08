# Suivi Sport

Application web personnelle (PWA) pour suivre mes séances de sport : échauffement, cardio (elliptique, tapis...), renforcement musculaire sur machines, et poids hebdomadaire — avec graphiques de progression.

Projet 100% statique (HTML/CSS/JS vanilla, aucun build), données stockées uniquement en local sur l'appareil (IndexedDB). Aucun compte, aucun serveur.

## Lancer en local

Depuis ce dossier :

```bash
python3 -m http.server 8000
```

Puis ouvrir http://localhost:8000 dans le navigateur (nécessaire pour que le service worker et IndexedDB fonctionnent — ouvrir `index.html` directement en `file://` ne fonctionnera pas).

## Déploiement (GitHub Pages)

1. Créer un dépôt GitHub (public ou privé) et y pousser ce dossier.
2. Dans les réglages du dépôt → Pages, choisir la branche `main` et le dossier racine (`/`).
3. L'app sera accessible à `https://<utilisateur>.github.io/<nom-du-repo>/`.
4. Depuis le téléphone (Safari iOS ou Chrome Android), ouvrir cette URL puis « Ajouter à l'écran d'accueil » pour l'installer comme une app.

## Sauvegarde des données

Les données vivent uniquement dans le navigateur de l'appareil. Utiliser le bouton **Exporter (JSON)** dans les réglages (⚙️) régulièrement pour ne rien perdre en cas de changement de téléphone ou de nettoyage du cache. Le bouton **Importer (JSON)** permet de restaurer une sauvegarde (remplace les données actuelles).

## Structure

```
index.html            App shell, une seule page
manifest.json          Manifest PWA
sw.js                   Service worker (cache offline)
css/app.css             Styles
js/db.js                Wrapper IndexedDB
js/seed.js              Machines par défaut
js/app.js               Logique de l'application
js/charts.js             Graphiques (Chart.js)
js/vendor/chart.min.js    Chart.js vendorisé (offline)
icons/                    Icônes PWA
```
