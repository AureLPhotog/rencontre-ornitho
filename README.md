# Rencontre Ornitho

Mes listes d'oiseaux : lifers photo, photo France, AURA, Rhône, jardin, bureau, Ouessant, Guyane, year lists.

- **L'appli** (ce dépôt, public) : une page web statique publiée par GitHub Pages. Aucune donnée ici.
- **La base** (dépôt privé `rencontre-ornitho-data`) : des fichiers JSON, une ligne par coche. L'appli les lit et les modifie par l'API GitHub avec une clé d'accès personnelle (fine-grained, *Contents : Read and write* sur ce seul dépôt), gardée sur chaque appareil.

Chaque modification faite dans l'appli devient un commit dans la base : l'historique complet reste consultable sur GitHub. Hors ligne, les changements attendent sur l'appareil et partent au retour du réseau.

Pas de compilation : HTML, CSS et modules JavaScript. Bibliothèques chargées depuis un CDN : Leaflet (carte), SheetJS (export Excel).
