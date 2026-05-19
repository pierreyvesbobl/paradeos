-- Nouveau statut de tâche : `awaiting_client` (en attente côté client).
-- Différent de `blocked` qui signifie "bloqué par un obstacle technique",
-- ici on attend explicitement une action ou un retour du client.

alter type task_status add value if not exists 'awaiting_client' after 'in_progress';
