# Mettre Basirah en ligne (sans terminal)

Le dossier `public/` contient la page de test COMPLÈTE (un seul fichier `index.html`, déjà construit). Le micro ne fonctionne que sur une adresse https.

## Option A — la plus simple : Netlify Drop (aucun compte GitHub requis)
1. Ouvrir https://app.netlify.com/drop, glisser le dossier `public` : vous obtenez un lien https.
2. Ouvrir ce lien dans Chrome ou Edge.

## Option B — GitHub (dépôt privé)
1. GitHub → New repository → **Private** → Create.
2. « uploading an existing file » : glisser TOUT le contenu du dossier du projet (le dossier `.github` compris).
3. GitHub Pages sur un dépôt privé exige un abonnement payant ; sinon utilisez l'option A ou Cloudflare Pages (connecter le dépôt, dossier de sortie `public`, commande `npm run build:app`).
Le fichier `.github/workflows/pages.yml` reconstruit et publie la page à chaque envoi.

Après chaque modification faite par moi, vous remplacez `public/index.html` (ou renvoyez le projet).
