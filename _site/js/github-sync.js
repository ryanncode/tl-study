/**
 * github-sync.js
 * 
 * Handles GitHub App OAuth Web Flow, automatic repository discovery, 
 * syncing JSON/Markdown data to a student's personal repo, and managing version archives.
 */

const SYNC_CONFIG = {
    // Client ID for the GitHub App
    clientId: 'GITHUB_APP_CLIENT_ID',
    // The relay server URL that exchanges the web flow code for a token (Cloudflare Worker)
    tokenRelayUrl: 'https://oauth-relay.thing.rodeo/api/token',
    // Local storage keys
    tokenKey: 'tl_study_github_token',
    repoKey: 'tl_study_github_repo',
    ownerKey: 'tl_study_github_owner',
    // Destination file paths inside the student's repo
    dataFilePath: 'nf-set-theory/data.json',
    markdownFilePath: 'nf-set-theory/Solutions.md',
    readmeFilePath: 'nf-set-theory/README.md'
};

const STUDENT_README = `# NF Set Theory & Categorical Semantics

Welcome to your personal study repository for the **Thinghood Limited: NF Set Theory** curriculum.

This folder contains your serialized problem set solutions and active state data for the 8-part deep dive into Quine's New Foundations (NF) and Categorical Logic.

## The Monistic Universe

Traditional, standard ontologies (built on Zermelo-Fraenkel set theory) rely on strict, top-down hierarchies. They mathematically forbid a "universal set" (a category that contains itself) because of the Axiom of Foundation and Russell's Paradox. 

In this curriculum, you are learning the structural mechanics of a **Monistic Universe**—a single, flat, self-containing totality where the Universal Set ($V \\in V$) is mathematically permitted.

## Your Files

This directory is automatically managed by the Thinghood Limited study application. It contains two primary files generated from your problem sets:

1. **\`Solutions.md\`**: A human-readable Markdown file containing your written solutions to the problem sets. You can read this file directly on GitHub, and it will render beautifully in the web interface.
2. **\`data.json\`**: A machine-readable state file. This allows the study web application to reload your answers into the text fields if you return to the curriculum on a new device.

> **Note:** Any manual edits made to \`data.json\` will be reflected in the web application upon your next login. However, manual edits to \`Solutions.md\` will be overwritten the next time you click "Save to GitHub" from the web interface.
`;

class GitHubSync {
    constructor() {
        this.token = localStorage.getItem(SYNC_CONFIG.tokenKey);
        this.owner = localStorage.getItem(SYNC_CONFIG.ownerKey);
        this.repo = localStorage.getItem(SYNC_CONFIG.repoKey);
        this.data = {}; // Active JSON payload representing user problem set solutions
        this.curriculumVersions = null; // Holds the hashes from versions.json
    }

    isAuthenticated() {
        return !!this.token;
    }
    
    isFullyConfigured() {
        return this.isAuthenticated() && !!this.repo && !!this.owner;
    }

    /**
     * Initializes the Web Authorization Flow
     */
    startAuthFlow() {
        const redirectUri = window.location.origin + window.location.pathname;
        const authUrl = \`https://github.com/login/oauth/authorize?client_id=\${SYNC_CONFIG.clientId}&redirect_uri=\${encodeURIComponent(redirectUri)}\`;
        window.location.href = authUrl;
    }

    /**
     * Checks if the user just returned from the OAuth flow with a ?code= parameter
     */
    async handleOAuthCallback() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        
        if (code) {
            // Remove code from URL to prevent refreshing and using it again
            window.history.replaceState({}, document.title, window.location.pathname);
            
            try {
                // Exchange code for token via serverless relay
                const res = await fetch(SYNC_CONFIG.tokenRelayUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: code })
                });

                if (res.status === 200) {
                    const data = await res.json();
                    if (data.access_token) {
                        this.token = data.access_token;
                        localStorage.setItem(SYNC_CONFIG.tokenKey, this.token);
                        console.log("Successfully authenticated with GitHub.");
                        
                        await this.discoverRepository();
                    } else {
                        console.error("Token exchange failed:", data);
                    }
                } else {
                    console.error("Relay returned error:", await res.text());
                }
            } catch (err) {
                console.error("Error during token exchange:", err);
            }
        }
    }

    /**
     * Automatically discover the repository where the GitHub App is installed
     */
    async discoverRepository() {
        if (!this.token) return;
        
        try {
            const headers = {
                'Authorization': \`Bearer \${this.token}\`,
                'Accept': 'application/vnd.github.v3+json'
            };

            // 1. Get the user's installations of this app
            const instRes = await fetch('https://api.github.com/user/installations', { headers });
            if (instRes.status !== 200) throw new Error("Failed to fetch installations");
            
            const instData = await instRes.json();
            if (instData.total_count === 0 || instData.installations.length === 0) {
                alert("GitHub App is not installed on any repository. Please install it on your designated study repository.");
                return;
            }
            
            // Just use the first installation
            const installationId = instData.installations[0].id;
            
            // 2. Get the repositories accessible by this installation
            const repoRes = await fetch(\`https://api.github.com/user/installations/\${installationId}/repositories\`, { headers });
            if (repoRes.status !== 200) throw new Error("Failed to fetch repositories");
            
            const repoData = await repoRes.json();
            if (repoData.total_count === 0 || repoData.repositories.length === 0) {
                alert("The GitHub App was installed, but no repositories were selected. Please configure the app's repository access.");
                return;
            }
            
            // Use the first accessible repository
            const repo = repoData.repositories[0];
            this.owner = repo.owner.login;
            this.repo = repo.name;
            
            localStorage.setItem(SYNC_CONFIG.ownerKey, this.owner);
            localStorage.setItem(SYNC_CONFIG.repoKey, this.repo);
            
            console.log(\`Automatically discovered repository: \${this.owner}/\${this.repo}\`);
            
            // Now that we have the repo, load the data
            this.loadData();
            
        } catch (error) {
            console.error("Error discovering repository:", error);
        }
    }

    /**
     * Reads the current JSON state from GitHub via REST API
     */
    async loadData(skipRebuildSwitcher = false) {
        // 0. Load current curriculum versions
        try {
            const versionRes = await fetch('/versions.json');
            if (versionRes.ok) {
                this.curriculumVersions = await versionRes.json();
            }
        } catch (e) {
            console.error("Failed to load versions.json", e);
        }

        if (!this.isFullyConfigured()) {
            const sandboxData = localStorage.getItem('tl_study_sandbox_data');
            if (sandboxData) {
                this.data = JSON.parse(sandboxData);
                this.populateFields();
                console.log("Loaded data from Local Sandbox Mode.");
                this.checkVersionDrift();
            }
            return;
        }

        const headers = {
            'Authorization': \`Bearer \${this.token}\`,
            'Accept': 'application/vnd.github.v3+json'
        };

        // 1. Load JSON Data
        const jsonUrl = \`https://api.github.com/repos/\${this.owner}/\${this.repo}/contents/\${SYNC_CONFIG.dataFilePath}\`;
        try {
            const jsonRes = await fetch(jsonUrl, { headers });
            if (jsonRes.status === 200) {
                const fileData = await jsonRes.json();
                this.fileSha = fileData.sha;
                this.data = JSON.parse(decodeURIComponent(escape(atob(fileData.content))));
                this.populateFields();
            } else if (jsonRes.status === 404) {
                console.log("No existing JSON data file found. Starting fresh.");
                this.data = {};
            }
        } catch (error) {
            console.error("Error loading JSON data:", error);
        }

        // 2. Load Markdown SHA
        const mdUrl = \`https://api.github.com/repos/\${this.owner}/\${this.repo}/contents/\${SYNC_CONFIG.markdownFilePath}\`;
        try {
            const mdRes = await fetch(mdUrl, { headers });
            if (mdRes.status === 200) {
                const mdData = await mdRes.json();
                this.mdFileSha = mdData.sha;
            }
        } catch (error) {
            console.error("Error fetching Markdown SHA:", error);
        }

        // 3. Load README SHA
        const readmeUrl = \`https://api.github.com/repos/\${this.owner}/\${this.repo}/contents/\${SYNC_CONFIG.readmeFilePath}\`;
        try {
            const readmeRes = await fetch(readmeUrl, { headers });
            if (readmeRes.status === 200) {
                const readmeData = await readmeRes.json();
                this.readmeFileSha = readmeData.sha;
            }
        } catch (error) {
            console.error("Error fetching README SHA:", error);
        }

        this.checkVersionDrift();
        if (!skipRebuildSwitcher) {
            this.buildVersionSwitcher();
        }
    }

    checkVersionDrift() {
        if (this.curriculumVersions && this.data._metadata && this.data._metadata.master_hash) {
            if (this.curriculumVersions.curriculum_master_hash !== this.data._metadata.master_hash) {
                this.showOutdatedWarning();
            }
        }
    }

    showOutdatedWarning() {
        if (document.getElementById('version-warning')) return;
        const target = document.querySelector('main') || document.body;
        const banner = document.createElement('div');
        banner.id = 'version-warning';
        banner.className = 'alert alert-warning mt-3';
        banner.innerHTML = \`<strong>Curriculum Updated:</strong> The curriculum has been updated since your last save. You are viewing your answers for an older version.\`;
        target.prepend(banner);
    }

    async buildVersionSwitcher() {
        if (!this.isFullyConfigured()) return;
        const url = \`https://api.github.com/repos/\${this.owner}/\${this.repo}/contents/nf-set-theory/archive\`;
        try {
            const res = await fetch(url, { headers: { 'Authorization': \`Bearer \${this.token}\`, 'Accept': 'application/vnd.github.v3+json' } });
            if (res.status === 200) {
                const folders = await res.json();
                if (folders.length > 0) {
                    let container = document.getElementById('version-switcher-container');
                    if (!container) {
                        container = document.createElement('div');
                        container.id = 'version-switcher-container';
                        container.className = 'alert alert-info mt-3 d-flex align-items-center justify-content-between';
                        const target = document.querySelector('main') || document.body;
                        target.prepend(container);
                    }
                    
                    container.innerHTML = \`<span><strong>Version History:</strong> View previous saves</span>\`;
                    
                    const select = document.createElement('select');
                    select.className = 'form-select w-auto';
                    select.innerHTML = \`<option value="latest">Latest Save (Root)</option>\`;
                    
                    const currentActiveHash = (this.data._metadata && this.data._metadata.master_hash) ? this.data._metadata.master_hash : null;
                    
                    folders.forEach(f => {
                        if (f.type === 'dir') {
                            const opt = document.createElement('option');
                            opt.value = f.name;
                            opt.textContent = \`Version Hash: \${f.name}\`;
                            if (currentActiveHash === f.name) opt.selected = true;
                            select.appendChild(opt);
                        }
                    });
                    
                    select.addEventListener('change', (e) => this.loadArchivedVersion(e.target.value));
                    container.appendChild(select);
                }
            }
        } catch (e) {
            console.log("No archive folder found or error fetching.", e);
        }
    }

    async loadArchivedVersion(hash) {
        if (hash === 'latest') {
            await this.loadData(true);
            return;
        }
        
        const url = \`https://api.github.com/repos/\${this.owner}/\${this.repo}/contents/nf-set-theory/archive/\${hash}/data.json\`;
        try {
            const res = await fetch(url, { headers: { 'Authorization': \`Bearer \${this.token}\`, 'Accept': 'application/vnd.github.v3+json' } });
            if (res.status === 200) {
                const fileData = await res.json();
                this.data = JSON.parse(decodeURIComponent(escape(atob(fileData.content))));
                this.populateFields();
                this.checkVersionDrift();
            }
        } catch (e) {
            console.error("Failed to load archive", e);
        }
    }

    /**
     * Writes the current JSON state back to GitHub via REST API
     */
    async saveData() {
        this.collectFields();
        
        // Stamp metadata
        if (!this.data._metadata) this.data._metadata = {};
        this.data._metadata.last_saved = new Date().toISOString();
        if (this.curriculumVersions) {
            this.data._metadata.master_hash = this.curriculumVersions.curriculum_master_hash;
        }

        if (!this.isFullyConfigured()) {
            console.log("Not authenticated with GitHub. Saving to Local Sandbox Mode.");
            localStorage.setItem('tl_study_sandbox_data', JSON.stringify(this.data));
            alert("Saved locally to your browser (Sandbox Mode). Connect GitHub to sync across devices.");
            return;
        }

        const headers = {
            'Authorization': \`Bearer \${this.token}\`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        };

        // 1. Save JSON File
        const jsonUrl = \`https://api.github.com/repos/\${this.owner}/\${this.repo}/contents/\${SYNC_CONFIG.dataFilePath}\`;
        const jsonBody = {
            message: "Auto-sync JSON from TL Study",
            content: btoa(unescape(encodeURIComponent(JSON.stringify(this.data, null, 2))))
        };
        if (this.fileSha) jsonBody.sha = this.fileSha;

        try {
            const jsonRes = await fetch(jsonUrl, { method: 'PUT', headers, body: JSON.stringify(jsonBody) });
            if (jsonRes.status === 200 || jsonRes.status === 201) {
                const resData = await jsonRes.json();
                this.fileSha = resData.content.sha;
            }
        } catch (error) {
            console.error("Error saving JSON to GitHub:", error);
        }

        // 2. Generate and Save Markdown File
        const mdUrl = \`https://api.github.com/repos/\${this.owner}/\${this.repo}/contents/\${SYNC_CONFIG.markdownFilePath}\`;
        let markdownContent = \`# NF Set Theory - My Solutions\\n\\n*These solutions were automatically synced from the TL Study platform.*\\n\\n---\\n\\n\`;
        
        // Exclude metadata from human-readable markdown
        for (const [key, value] of Object.entries(this.data)) {
            if (key === '_metadata') continue;
            markdownContent += \`### Problem ID: \\\`\${key}\\\`\\n\${value}\\n\\n\`;
        }

        const mdBody = {
            message: "Auto-sync Markdown from TL Study",
            content: btoa(unescape(encodeURIComponent(markdownContent)))
        };
        if (this.mdFileSha) mdBody.sha = this.mdFileSha;

        try {
            const mdRes = await fetch(mdUrl, { method: 'PUT', headers, body: JSON.stringify(mdBody) });
            if (mdRes.status === 200 || mdRes.status === 201) {
                const resData = await mdRes.json();
                this.mdFileSha = resData.content.sha;
            }
        } catch (error) {
            console.error("Error saving Markdown to GitHub:", error);
        }

        // 3. Save README File
        if (!this.readmeFileSha) {
            const readmeUrl = \`https://api.github.com/repos/\${this.owner}/\${this.repo}/contents/\${SYNC_CONFIG.readmeFilePath}\`;
            const readmeBody = {
                message: "Initialize NF Set Theory README",
                content: btoa(unescape(encodeURIComponent(STUDENT_README)))
            };
            try {
                const readmeRes = await fetch(readmeUrl, { method: 'PUT', headers, body: JSON.stringify(readmeBody) });
                if (readmeRes.status === 200 || readmeRes.status === 201) {
                    const resData = await readmeRes.json();
                    this.readmeFileSha = resData.content.sha;
                }
            } catch (error) {
                console.error("Error saving README to GitHub:", error);
            }
        }

        // 4. Archival Save
        if (this.curriculumVersions && this.curriculumVersions.curriculum_master_hash) {
            const hash = this.curriculumVersions.curriculum_master_hash;
            const archiveJsonUrl = \`https://api.github.com/repos/\${this.owner}/\${this.repo}/contents/nf-set-theory/archive/\${hash}/data.json\`;
            const archiveMdUrl = \`https://api.github.com/repos/\${this.owner}/\${this.repo}/contents/nf-set-theory/archive/\${hash}/Solutions.md\`;
            
            // Check if archive files already exist
            const getJsonRes = await fetch(archiveJsonUrl, { headers });
            if (getJsonRes.status === 200) {
                const existing = await getJsonRes.json();
                jsonBody.sha = existing.sha;
            } else { delete jsonBody.sha; }
            await fetch(archiveJsonUrl, { method: 'PUT', headers, body: JSON.stringify(jsonBody) });

            const getMdRes = await fetch(archiveMdUrl, { headers });
            if (getMdRes.status === 200) {
                const existing = await getMdRes.json();
                mdBody.sha = existing.sha;
            } else { delete mdBody.sha; }
            await fetch(archiveMdUrl, { method: 'PUT', headers, body: JSON.stringify(mdBody) });
            
            console.log("Successfully updated archives for hash: " + hash);
        }

        console.log("Sync complete.");
        this.buildVersionSwitcher();
        
        const warning = document.getElementById('version-warning');
        if (warning && this.data._metadata.master_hash === this.curriculumVersions.curriculum_master_hash) {
            warning.remove();
        }
    }

    collectFields() {
        const inputs = document.querySelectorAll('.problem-input');
        inputs.forEach(input => {
            const id = input.getAttribute('id');
            if (id) {
                this.data[id] = input.value;
            }
        });
    }

    populateFields() {
        for (const [key, value] of Object.entries(this.data)) {
            if (key === '_metadata') continue;
            const el = document.getElementById(key);
            if (el) {
                el.value = value;
            }
        }
    }
}

// Global instance
window.tlStudySync = new GitHubSync();

// Auto-load or handle callbacks
document.addEventListener('DOMContentLoaded', async () => {
    // If URL has a code, we are returning from OAuth
    if (window.location.search.includes('code=')) {
        await window.tlStudySync.handleOAuthCallback();
    } else {
        window.tlStudySync.loadData();
    }
});
