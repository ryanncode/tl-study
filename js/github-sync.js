/**
 * github-sync.js
 * 
 * Handles GitHub App OAuth Web Flow, automatic repository discovery, 
 * syncing JSON/Markdown data to a student's personal repo, and managing version archives.
 */

const SYNC_CONFIG = {
    clientId: 'GITHUB_APP_CLIENT_ID',
    tokenRelayUrl: 'https://oauth-relay.thing.rodeo/api/token',
    tokenKey: 'tl_study_github_token',
    repoKey: 'tl_study_github_repo',
    ownerKey: 'tl_study_github_owner'
};

const STUDENT_README = `# Thinghood Limited Curriculum\n\nWelcome to your personal study repository.\n\nThis directory is automatically managed by the Thinghood Limited study application. It contains two primary files generated from your problem sets for each curriculum topic:\n\n1. **\`Solutions.md\`**: A human-readable Markdown file containing your written solutions to the problem sets.\n2. **\`data.json\`**: A machine-readable state file to reload your answers.\n`;

class GitHubSync {
    constructor() {
        this.token = localStorage.getItem(SYNC_CONFIG.tokenKey);
        this.owner = localStorage.getItem(SYNC_CONFIG.ownerKey);
        this.repo = localStorage.getItem(SYNC_CONFIG.repoKey);
        this.data = {}; 
        this.curriculumVersions = null;
    }

    isAuthenticated() {
        return !!this.token;
    }
    
    isFullyConfigured() {
        return this.isAuthenticated() && !!this.repo && !!this.owner;
    }

    getCurrentTopic() {
        const pathSegments = window.location.pathname.split('/').filter(Boolean);
        
        // If we are on an archive page: /archive/topic_basename_hash.html
        if (pathSegments[0] === 'archive' && pathSegments.length > 1) {
            const archiveMatch = pathSegments[1].match(/^([^_]+)_([^_]+)_([a-f0-9]+)\.html$/);
            if (archiveMatch) return archiveMatch[1];
        }
        
        // Otherwise, the first directory in the path is the topic (e.g. /nf-set-theory/index.html)
        return pathSegments[0] || 'unknown-topic';
    }

    getCurrentBasename() {
        const pathSegments = window.location.pathname.split('/').filter(Boolean);
        let filename = pathSegments[pathSegments.length - 1] || 'index.html';
        
        const archiveMatch = filename.match(/^([^_]+)_([^_]+)_([a-f0-9]+)\.html$/);
        if (archiveMatch) {
            return archiveMatch[2]; // basename
        }
        return filename.replace('.html', '');
    }

    getArchiveHash() {
        const pathSegments = window.location.pathname.split('/').filter(Boolean);
        let filename = pathSegments[pathSegments.length - 1] || 'index.html';
        const archiveMatch = filename.match(/^([^_]+)_([^_]+)_([a-f0-9]+)\.html$/);
        return archiveMatch ? archiveMatch[3] : null; // hash
    }

    startAuthFlow() {
        const state = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        sessionStorage.setItem('oauth_state', state);
        const redirectUri = window.location.origin + window.location.pathname;
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${SYNC_CONFIG.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
        window.location.href = authUrl;
    }

    async handleOAuthCallback() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        
        if (code) {
            const savedState = sessionStorage.getItem('oauth_state');
            sessionStorage.removeItem('oauth_state');
            if (!state || state !== savedState) {
                console.error("OAuth state mismatch. Possible CSRF attack.");
                alert("Security check failed during login. Please try again.");
                return;
            }

            window.history.replaceState({}, document.title, window.location.pathname);
            try {
                const res = await fetch(SYNC_CONFIG.tokenRelayUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'oauth', code: code })
                });

                if (res.status === 200) {
                    const data = await res.json();
                    if (data.access_token) {
                        this.token = data.access_token;
                        localStorage.setItem(SYNC_CONFIG.tokenKey, this.token);
                        console.log("Successfully authenticated with GitHub.");
                        await this.discoverRepository();
                    }
                }
            } catch (err) {
                console.error("Error during token exchange:", err);
            }
        }
    }

    async discoverRepository() {
        if (!this.token) return;
        try {
            const headers = {
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/vnd.github.v3+json'
            };

            const instRes = await fetch('https://api.github.com/user/installations', { headers });
            if (instRes.status !== 200) throw new Error("Failed to fetch installations");
            
            const instData = await instRes.json();
            if (instData.total_count === 0 || instData.installations.length === 0) {
                alert("GitHub App is not installed on any repository.");
                return;
            }
            
            const installationId = instData.installations[0].id;
            const repoRes = await fetch(`https://api.github.com/user/installations/${installationId}/repositories`, { headers });
            if (repoRes.status !== 200) throw new Error("Failed to fetch repositories");
            
            const repoData = await repoRes.json();
            if (repoData.total_count === 0 || repoData.repositories.length === 0) {
                alert("No repositories were selected.");
                return;
            }
            
            let repo;
            if (repoData.repositories.length === 1) {
                repo = repoData.repositories[0];
            } else {
                const names = repoData.repositories.map(r => r.full_name).join("\n");
                const chosen = prompt(`You have multiple repositories selected. Which one should we use?\n\n${names}`);
                repo = repoData.repositories.find(r => r.full_name === chosen || r.name === chosen);
                if (!repo) {
                    alert("Invalid repository selected.");
                    return;
                }
            }
            
            this.owner = repo.owner.login;
            this.repo = repo.name;
            
            localStorage.setItem(SYNC_CONFIG.ownerKey, this.owner);
            localStorage.setItem(SYNC_CONFIG.repoKey, this.repo);
            
            this.loadData();
            
        } catch (error) {
            console.error("Error discovering repository:", error);
        }
    }

    async loadData(skipRebuildSwitcher = false) {
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
                this.checkVersionDrift();
            }
            return;
        }

        const headers = {
            'Authorization': `Bearer ${this.token}`,
            'Accept': 'application/vnd.github.v3+json'
        };

        const archiveHash = this.getArchiveHash();
        const basename = this.getCurrentBasename();
        const topic = this.getCurrentTopic();
        
        let jsonPath = `${topic}/data.json`;
        if (archiveHash) {
            jsonPath = `${topic}/archive/${basename}/${archiveHash}/data.json`;
            console.log(`Running in Archive Mode for ${topic}/${basename} (hash: ${archiveHash})`);
        }

        const jsonUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${jsonPath}`;
        try {
            const jsonRes = await fetch(jsonUrl, { headers });
            if (jsonRes.status === 200) {
                const fileData = await jsonRes.json();
                this.fileSha = fileData.sha;
                this.data = JSON.parse(decodeURIComponent(escape(atob(fileData.content))));
                this.populateFields();
                if (archiveHash) {
                    this.disableFields();
                }
            } else if (jsonRes.status === 404) {
                this.data = {};
            }
        } catch (error) {
            console.error("Error loading JSON data:", error);
        }

        const mdUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${topic}/Solutions.md`;
        try {
            const mdRes = await fetch(mdUrl, { headers });
            if (mdRes.status === 200) {
                const mdData = await mdRes.json();
                this.mdFileSha = mdData.sha;
            }
        } catch (error) {}

        const readmeUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/README.md`;
        try {
            const readmeRes = await fetch(readmeUrl, { headers });
            if (readmeRes.status === 200) {
                const readmeData = await readmeRes.json();
                this.readmeFileSha = readmeData.sha;
            }
        } catch (error) {}

        this.checkVersionDrift();
        if (!skipRebuildSwitcher) {
            this.buildVersionSwitcher();
        }
    }

    checkVersionDrift() {
        const topic = this.getCurrentTopic();
        const basename = this.getCurrentBasename();
        const docKey = `${topic}/${basename}.qmd`;
        
        if (this.curriculumVersions && this.curriculumVersions.documents[docKey] && this.data._metadata && this.data._metadata.document_hashes) {
            const liveHash = this.curriculumVersions.documents[docKey].document_hash;
            const savedHash = this.data._metadata.document_hashes[docKey];
            
            if (savedHash && liveHash !== savedHash) {
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
        banner.innerHTML = `<strong>Topic Updated:</strong> This topic has been updated since your last save. You are viewing your answers for an older version.`;
        target.prepend(banner);
    }

    buildVersionSwitcher() {
        if (!this.curriculumVersions) return;
        
        const topic = this.getCurrentTopic();
        const basename = this.getCurrentBasename();
        const docKey = `${topic}/${basename}.qmd`;
        const docData = this.curriculumVersions.documents[docKey];
        
        if (!docData || (!docData.historical_hashes || docData.historical_hashes.length === 0)) {
            return; // No history for this file
        }
        
        let container = document.getElementById('version-switcher-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'version-switcher-container';
            container.className = 'alert alert-info mt-3 d-flex align-items-center justify-content-between';
            const target = document.querySelector('main') || document.body;
            target.prepend(container);
        }
        
        container.innerHTML = `<span><strong>Topic History:</strong> View previous versions of this page</span>`;
        
        const select = document.createElement('select');
        select.className = 'form-select w-auto';
        select.innerHTML = `<option value="latest">Latest Save (Live)</option>`;
        
        const archiveHash = this.getArchiveHash();

        docData.historical_hashes.forEach(hash => {
            const opt = document.createElement('option');
            opt.value = hash;
            opt.textContent = `Version: ${hash}`;
            if (archiveHash === hash) opt.selected = true;
            select.appendChild(opt);
        });
        
        select.addEventListener('change', (e) => this.loadArchivedVersion(e.target.value));
        container.appendChild(select);
    }

    loadArchivedVersion(hash) {
        const topic = this.getCurrentTopic();
        const basename = this.getCurrentBasename();
        
        if (hash === 'latest') {
            window.location.href = `../${topic}/${basename}.html`;
            return;
        }
        
        const isArchivedPage = window.location.pathname.includes('/archive/');
        if (isArchivedPage) {
            window.location.href = `${topic}_${basename}_${hash}.html`;
        } else {
            window.location.href = `../archive/${topic}_${basename}_${hash}.html`;
        }
    }

    async saveData() {
        this.collectFields();
        
        const topic = this.getCurrentTopic();
        const basename = this.getCurrentBasename();
        const docKey = `${topic}/${basename}.qmd`;

        if (!this.data._metadata) this.data._metadata = { document_hashes: {} };
        if (!this.data._metadata.document_hashes) this.data._metadata.document_hashes = {};
        
        this.data._metadata.last_saved = new Date().toISOString();
        if (this.curriculumVersions && this.curriculumVersions.documents[docKey]) {
            this.data._metadata.document_hashes[docKey] = this.curriculumVersions.documents[docKey].document_hash;
        }

        if (!this.isFullyConfigured()) {
            localStorage.setItem('tl_study_sandbox_data', JSON.stringify(this.data));
            alert("Saved locally to your browser (Sandbox Mode). Connect GitHub to sync across devices.");
            return;
        }

        const headers = {
            'Authorization': `Bearer ${this.token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        };

        const jsonUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${topic}/data.json`;
        const jsonBody = {
            message: `Auto-sync JSON from TL Study (${docKey})`,
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

        const mdUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${topic}/Solutions.md`;
        let markdownContent = `# ${topic} - My Solutions\n\n*These solutions were automatically synced from the TL Study platform.*\n\n---\n\n`;
        for (const [key, value] of Object.entries(this.data)) {
            if (key === '_metadata') continue;
            markdownContent += `### Problem ID: \`${key}\`\n${value}\n\n`;
        }
        const mdBody = {
            message: `Auto-sync Markdown for ${topic}`,
            content: btoa(unescape(encodeURIComponent(markdownContent)))
        };
        if (this.mdFileSha) mdBody.sha = this.mdFileSha;

        try {
            const mdRes = await fetch(mdUrl, { method: 'PUT', headers, body: JSON.stringify(mdBody) });
            if (mdRes.status === 200 || mdRes.status === 201) {
                const resData = await mdRes.json();
                this.mdFileSha = resData.content.sha;
            }
        } catch (error) {}

        if (!this.readmeFileSha) {
            const readmeUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/README.md`;
            const readmeBody = {
                message: "Initialize README",
                content: btoa(unescape(encodeURIComponent(STUDENT_README)))
            };
            try {
                const readmeRes = await fetch(readmeUrl, { method: 'PUT', headers, body: JSON.stringify(readmeBody) });
                if (readmeRes.status === 200 || readmeRes.status === 201) {
                    const resData = await readmeRes.json();
                    this.readmeFileSha = resData.content.sha;
                }
            } catch (error) {}
        }

        if (this.curriculumVersions && this.curriculumVersions.documents[docKey]) {
            const hash = this.curriculumVersions.documents[docKey].document_hash;
            const archiveJsonUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${topic}/archive/${basename}/${hash}/data.json`;
            const getJsonRes = await fetch(archiveJsonUrl, { headers });
            if (getJsonRes.status === 200) {
                const existing = await getJsonRes.json();
                jsonBody.sha = existing.sha;
            } else { delete jsonBody.sha; }
            await fetch(archiveJsonUrl, { method: 'PUT', headers, body: JSON.stringify(jsonBody) });
        }

        console.log("Sync complete.");
        this.buildVersionSwitcher();
        
        const warning = document.getElementById('version-warning');
        if (warning) {
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

    disableFields() {
        const inputs = document.querySelectorAll('.problem-input');
        inputs.forEach(input => {
            input.disabled = true;
        });
        const buttons = document.querySelectorAll('button[onclick="tlStudySync.saveData()"]');
        buttons.forEach(b => {
            b.disabled = true;
            b.textContent = "Archived (Read-Only)";
        });
    }
}

window.tlStudySync = new GitHubSync();

document.addEventListener('DOMContentLoaded', async () => {
    if (window.location.search.includes('code=')) {
        await window.tlStudySync.handleOAuthCallback();
    } else {
        window.tlStudySync.loadData();
    }
});
