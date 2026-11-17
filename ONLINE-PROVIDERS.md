# Moteur en ligne : changer de fournisseur sans reconstruire

Architecture : navigateur → relais Basirah (`server/relay.mjs`, détient la clé) → fournisseur. Chaque fournisseur est un adaptateur dans le relais ; la page ne change pas. Rien de payant n'est activé.

**Recommandation honnête** : je n'ai pas pu vérifier en ligne les prix, la qualité de l'arabe coranique ni le streaming actuels de chaque fournisseur, et aucun n'a été testé sur de la récitation. Je ne vous recommande donc pas un fournisseur « le meilleur » sur la foi de mes souvenirs. Méthode : choisir 2–3 candidats parmi ceux qui annoncent l'arabe en streaming (Deepgram — adaptateur déjà écrit mais NON testé ; Google Cloud Speech-to-Text ; Azure Speech ; autres), les passer sur VOS mêmes enregistrements avec le banc (`npm run eval`), et comparer WER/CER, latence du premier mot, coût par heure. Aucun compte payant n'est ouvert sans votre accord.
Pour un test sans clé : le moteur « TEST navigateur » (Google via Chrome) est clairement identifié comme tel.
