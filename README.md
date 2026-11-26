# TVT26KMO-Linux-LLM: self-hosted LLM chat with CI/CD

A web chat where you talk to a language model running **locally** on my cPouta server. Every push to `main` is linted, tested and deployed automatically with GitHub Actions.

- Chat: http://195.148.31.130/viikko5/
- Health endpoint: http://195.148.31.130/viikko5/health (returns the running Git commit SHA)
- Repository: https://github.com/saarijk/TVT26KMO-Linux-LLM

## Architecture

```
Browser -> Nginx (port 80) -> Unix socket -> Gunicorn + Flask -> Ollama (127.0.0.1:11434)
                                                              -> MariaDB (database "chatapp")
GitHub Actions --SSH (port 22)--> rsync + scripts/deploy.sh
```

| Part | Role |
|---|---|
| Nginx | Only service reachable from the internet; `/viikko5/` is added through an include snippet |
| Gunicorn + Flask | The Python app, run by systemd as the dedicated user `chatapp` |
| Ollama | Runs the model `qwen2.5:0.5b`, listens on localhost only |
| MariaDB | Stores the conversation in table `messages`, one session per browser |

## Repository layout

| Path | Contents |
|---|---|
| `app.py`, `db.py` | Flask routes and the database layer |
| `templates/`, `static/` | Chat page, JavaScript and CSS |
| `test_app.py` | Tests (the model and database are mocked) |
| `deploy/nginx/chatapp.conf` | Nginx `location` blocks for `/viikko5/` |
| `deploy/systemd/chatapp.service` | systemd unit |
| `deploy/sql/schema.sql` | Database schema |
| `scripts/server-setup.sh` | One-time server setup |
| `scripts/deploy.sh` | Deployment script run by the pipeline |
| `.github/workflows/ci-cd.yml` | CI/CD pipeline |

## Running locally

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-dev.txt
ruff check .
pytest
flask --app app run --debug
```

Without `DB_NAME` set, messages are kept in memory, so no database is needed. Chatting needs a local Ollama.

## One-time server setup

1. Check resources: `free -h`, `df -h /`, `sudo ss -ltnp`. Add swap if needed.
2. Copy the setup script and run it on the server:
   ```bash
   scp scripts/server-setup.sh ubuntu@<server-ip>:~
   bash server-setup.sh qwen2.5:0.5b
   ```
   It installs Ollama and the model, creates the `chatapp` system user, the `chatapp` database and database user, and writes `/etc/chatapp/chatapp.env`.
3. Add this line once to the `server { }` block of the existing Nginx site, then test and reload:
   ```nginx
   include snippets/chatapp.conf;
   ```
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```
4. Create a **separate** SSH key pair for GitHub Actions (not your personal key), and add the public key to `~/.ssh/authorized_keys` on the server.
5. Add these repository secrets (Settings > Secrets and variables > Actions):

   | Secret | Value |
   |---|---|
   | `CPOUTA_HOST` | server public IP |
   | `CPOUTA_USER` | SSH user |
   | `CPOUTA_SSH_KEY` | the deploy private key |
   | `CPOUTA_KNOWN_HOSTS` | the server's host key line |

6. Make sure port 22 is reachable from GitHub's runners (see the documentation page for the security trade-off).

## Deployment

Pushing to `main` runs the workflow:

1. **test job** (every push and pull request): `ruff check .`, `pytest`, `bash -n scripts/*.sh`
2. **deploy job** (only on `main`, only if `test` passed): rsync the code to `/opt/chatapp/app`, run `scripts/deploy.sh <commit SHA>`, then run public smoke tests

`deploy.sh` installs dependencies, applies the schema as root, installs the Nginx snippet (restoring the old one if `nginx -t` fails), installs and restarts only `chatapp.service`, and then checks that the app reports the exact commit SHA. If it does not, the workflow fails.

## Security notes

- The app runs as the non-login system user `chatapp`.
- The database user has only `SELECT, INSERT` on its own database; the schema is applied by root.
- Secrets live in `/etc/chatapp/chatapp.env` (`root:chatapp`, mode 640) and in GitHub Actions secrets. None are committed.
- Ollama and Gunicorn listen only on localhost or a Unix socket.

## Documentation

The Week 5 documentation, test results and server evidence are on the `/viikko5/docs` page.