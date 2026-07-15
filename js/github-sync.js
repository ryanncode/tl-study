/**
 * github-sync.js
 * 
 * Handles GitHub App OAuth Device Flow and syncing JSON data
 * to a student's personal, private repository.
 * Based on the static API architecture outlined in github.tl-study.md
 */

const SYNC_CONFIG = {
    // Placeholder Client ID for the GitHub App (to be replaced with actual Client ID)
    clientId: 'GITHUB_APP_CLIENT_ID',
    // The relay server URL that exchanges device code for a token (serverless function)
    tokenRelayUrl: 'https://oauth-relay.thing.rodeo/api/token',
    // Local storage keys
    tokenKey: 'tl_study_github_token',
    repoKey: 'tl_study_github_repo',
    ownerKey: 'tl_study_github_owner',
    // Destination file path inside the repo
    dataFilePath: 'nf-set-theory-data.json'
};

class GitHubSync {
    constructor() {
        this.token = localStorage.getItem(SYNC_CONFIG.tokenKey);
        this.owner = localStorage.getItem(SYNC_CONFIG.ownerKey);
        this.repo = localStorage.getItem(SYNC_CONFIG.repoKey);
        this.data = {}; // Active JSON payload representing user problem set solutions
    }

    isAuthenticated() {
        return !!this.token && !!this.repo && !!this.owner;
    }

    /**
     * Initializes the Device Authorization Flow
     */
    async startDeviceFlow() {
        // Step 1: Request device and user codes
        try {
            const response = await fetch('https://github.com/login/device/code', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    client_id: SYNC_CONFIG.clientId
                })
            });
            const data = await response.json();
            
            // Present data.user_code to the user and prompt them to visit data.verification_uri
            this.showAuthPrompt(data.user_code, data.verification_uri);

            // Step 2: Poll the relay server for the token
            this.pollForToken(data.device_code, data.interval);

        } catch (error) {
            console.error("Failed to start device flow:", error);
        }
    }

    showAuthPrompt(userCode, url) {
        // In a real Quarto layout, this would manipulate the DOM to show a banner/modal.
        console.log(`Please go to ${url} and enter code: ${userCode}`);
        alert(`GitHub Auth Required: Go to ${url} and enter code: ${userCode}`);
    }

    async pollForToken(deviceCode, intervalSeconds) {
        let attempts = 0;
        const maxAttempts = 20;

        const interval = setInterval(async () => {
            attempts++;
            if (attempts > maxAttempts) {
                clearInterval(interval);
                console.error("Authentication timed out.");
                return;
            }

            try {
                // We call our serverless relay, passing the device code.
                // The relay uses the client_secret to call GitHub and return the token.
                const res = await fetch(SYNC_CONFIG.tokenRelayUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ device_code: deviceCode })
                });

                if (res.status === 200) {
                    const data = await res.json();
                    if (data.access_token) {
                        clearInterval(interval);
                        this.token = data.access_token;
                        localStorage.setItem(SYNC_CONFIG.tokenKey, this.token);
                        
                        // Assuming prompt for owner/repo happens here
                        this.owner = prompt("Enter your GitHub Username:");
                        this.repo = prompt("Enter the repository name (e.g., tl-study-notes):");
                        localStorage.setItem(SYNC_CONFIG.ownerKey, this.owner);
                        localStorage.setItem(SYNC_CONFIG.repoKey, this.repo);

                        console.log("Successfully authenticated and configured repository.");
                        this.loadData();
                    }
                }
            } catch (err) {
                // Just wait for the next interval
            }
        }, intervalSeconds * 1000);
    }

    /**
     * Reads the current JSON state from GitHub via REST API
     */
    async loadData() {
        if (!this.isAuthenticated()) return;

        const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${SYNC_CONFIG.dataFilePath}`;
        
        try {
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (response.status === 200) {
                const fileData = await response.json();
                this.fileSha = fileData.sha; // Needed for future PUT requests
                const decodedContent = atob(fileData.content);
                this.data = JSON.parse(decodedContent);
                this.populateFields();
            } else if (response.status === 404) {
                console.log("No existing data file found. Starting fresh.");
                this.data = {};
            } else {
                console.error("Failed to load data", response.status);
            }
        } catch (error) {
            console.error("Error loading data from GitHub:", error);
        }
    }

    /**
     * Writes the current JSON state back to GitHub via REST API
     */
    async saveData() {
        if (!this.isAuthenticated()) {
            alert("Not authenticated. Please connect your GitHub account first.");
            return;
        }

        // Collect all data from input fields
        this.collectFields();

        const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${SYNC_CONFIG.dataFilePath}`;
        const content = btoa(JSON.stringify(this.data, null, 2));

        const body = {
            message: "Auto-sync from TL Study (NF Set Theory)",
            content: content
        };

        if (this.fileSha) {
            body.sha = this.fileSha;
        }

        try {
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (response.status === 200 || response.status === 201) {
                const resData = await response.json();
                this.fileSha = resData.content.sha;
                console.log("Successfully saved data to GitHub.");
            } else {
                console.error("Failed to save data:", response.status);
            }
        } catch (error) {
            console.error("Error saving data to GitHub:", error);
        }
    }

    /**
     * Map active DOM elements (textareas, inputs) back into the JSON object
     */
    collectFields() {
        const inputs = document.querySelectorAll('.problem-input');
        inputs.forEach(input => {
            const id = input.getAttribute('id');
            if (id) {
                this.data[id] = input.value;
            }
        });
    }

    /**
     * Populate DOM elements from the loaded JSON object
     */
    populateFields() {
        for (const [key, value] of Object.entries(this.data)) {
            const el = document.getElementById(key);
            if (el) {
                el.value = value;
            }
        }
    }
}

// Global instance
window.tlStudySync = new GitHubSync();

// Auto-load if already authenticated
document.addEventListener('DOMContentLoaded', () => {
    if (window.tlStudySync.isAuthenticated()) {
        window.tlStudySync.loadData();
    }
});
