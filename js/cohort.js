/**
 * cohort.js
 * 
 * Manages the Seasonal Cohort Area UI and file-based API interaction.
 * Injects UI into problem sets for active topics and reads/writes to the central repository.
 */

class CohortManager {
    constructor() {
        this.config = null;
        this.activeTopicConfig = null;
        this.topic = this.getCurrentTopic();
    }

    getCurrentTopic() {
        const pathSegments = window.location.pathname.split('/').filter(Boolean);
        if (pathSegments[0] === 'archive' && pathSegments.length > 1) {
            const archiveMatch = pathSegments[1].match(/^([^_]+)_([^_]+)_([a-f0-9]+)\.html$/);
            if (archiveMatch) return archiveMatch[1];
        }
        return pathSegments[0] || 'unknown-topic';
    }

    async init() {
        try {
            const res = await fetch('/cohort_config.json');
            if (res.ok) {
                this.config = await res.json();
                this.checkActiveStatus();
            }
        } catch (e) {
            console.error("Failed to load cohort configuration:", e);
        }
    }

    checkActiveStatus() {
        if (!this.config || !this.config.active_topics) return;
        
        const now = new Date();
        const activeConfig = this.config.active_topics.find(t => t.topic === this.topic);
        
        if (activeConfig) {
            const startDate = new Date(activeConfig.start_date);
            const endDate = new Date(activeConfig.end_date);
            
            if (now >= startDate && now <= endDate) {
                this.activeTopicConfig = activeConfig;
                this.injectUI();
            }
        }
    }

    injectUI() {
        const problemInputs = document.querySelectorAll('.problem-input');
        if (problemInputs.length === 0) return;

        problemInputs.forEach(input => {
            const problemId = input.id;
            const cardBody = input.closest('.card-body');
            if (!cardBody) return;

            // 1. Inject Publish Button
            const saveBtn = cardBody.querySelector('button[onclick="tlStudySync.saveData()"]');
            if (saveBtn) {
                const publishBtn = document.createElement('button');
                publishBtn.className = 'btn btn-outline-primary mt-3 ms-2';
                publishBtn.innerHTML = 'Publish to Cohort';
                publishBtn.onclick = () => this.publishToCohort(problemId, input.value);
                saveBtn.parentNode.insertBefore(publishBtn, saveBtn.nextSibling);
            }

            // 2. Inject "View Cohort Solutions" Link & Container
            const cohortSection = document.createElement('div');
            cohortSection.className = 'mt-4 pt-3 border-top';
            
            const toggleLink = document.createElement('a');
            toggleLink.href = 'javascript:void(0)';
            toggleLink.className = 'fw-bold text-decoration-none';
            toggleLink.innerHTML = '&#9656; View Cohort Solutions & Commentary';
            
            const uiContainer = document.createElement('div');
            uiContainer.id = `cohort-ui-${problemId}`;
            uiContainer.className = 'd-none mt-3 p-3 bg-light rounded';
            uiContainer.innerHTML = '<div class="spinner-border spinner-border-sm text-primary" role="status"></div> Loading submissions...';

            let isExpanded = false;
            toggleLink.onclick = () => {
                isExpanded = !isExpanded;
                if (isExpanded) {
                    toggleLink.innerHTML = '&#9662; Hide Cohort Solutions & Commentary';
                    uiContainer.classList.remove('d-none');
                    this.fetchProblemSubmissions(problemId, uiContainer);
                } else {
                    toggleLink.innerHTML = '&#9656; View Cohort Solutions & Commentary';
                    uiContainer.classList.add('d-none');
                }
            };

            cohortSection.appendChild(toggleLink);
            cohortSection.appendChild(uiContainer);
            cardBody.appendChild(cohortSection);
        });
    }

    async getGitHubHeaders() {
        const headers = { 'Accept': 'application/vnd.github.v3+json' };
        
        // Use student's token if available for higher rate limits and potential write access
        const token = window.tlStudySync ? window.tlStudySync.token : localStorage.getItem('tl_study_github_token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }

    async deriveClientKey(passphrase) {
        const enc = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey("raw", enc.encode(passphrase), { name: "PBKDF2" }, false, ["deriveKey"]);
        return await window.crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: enc.encode("tl-study-salt"), iterations: 100000, hash: "SHA-256" },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    }

    async getPassphrase() {
        if (!this.passphrase) {
            this.passphrase = prompt("This cohort uses client-side encryption. Please enter the cohort passphrase:");
        }
        return this.passphrase;
    }

    async encryptPayload(payloadObj) {
        if (this.activeTopicConfig.encryption_mode !== 'client') return payloadObj;
        
        const passphrase = await this.getPassphrase();
        if (!passphrase) throw new Error("Passphrase required");
        const key = await this.deriveClientKey(passphrase);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(JSON.stringify(payloadObj));
        const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, encoded);
        return {
            encrypted: true,
            iv: btoa(String.fromCharCode(...iv)),
            data: btoa(String.fromCharCode(...new Uint8Array(encrypted)))
        };
    }

    async decryptPayload(contentStr) {
        if (this.activeTopicConfig.encryption_mode !== 'client') return JSON.parse(contentStr);
        
        try {
            const parsed = JSON.parse(contentStr);
            if (!parsed.encrypted) return parsed; // Not encrypted fallback
            
            const passphrase = await this.getPassphrase();
            if (!passphrase) throw new Error("Passphrase required");
            
            const key = await this.deriveClientKey(passphrase);
            const iv = new Uint8Array(atob(parsed.iv).split("").map(c => c.charCodeAt(0)));
            const data = new Uint8Array(atob(parsed.data).split("").map(c => c.charCodeAt(0)));
            const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, data);
            return JSON.parse(new TextDecoder().decode(decrypted));
        } catch (e) {
            this.passphrase = null; // Clear bad passphrase
            throw new Error("Invalid passphrase or corrupted data.");
        }
    }

    getApiConfig(path) {
        const targetRepo = this.activeTopicConfig.target_repo;
        if (this.activeTopicConfig.proxy_url) {
            const encMode = this.activeTopicConfig.encryption_mode || 'none';
            const cohortIdParam = this.activeTopicConfig.cohort_id ? `&cohortId=${this.activeTopicConfig.cohort_id}` : '';
            return {
                url: `${this.activeTopicConfig.proxy_url}?action=cohort_read&targetRepo=${targetRepo}&path=${path}&encryptionMode=${encMode}${cohortIdParam}`,
                useProxy: true
            };
        }
        return {
            url: `https://api.github.com/repos/${targetRepo}/contents/${path}`,
            useProxy: false
        };
    }

    async fetchProblemSubmissions(problemId, container) {
        const cohortId = this.activeTopicConfig.cohort_id || 'default';
        const path = `cohort_data/${this.topic}/${cohortId}/${problemId}`;
        const api = this.getApiConfig(path);
        
        try {
            const headers = await this.getGitHubHeaders();
            const res = await fetch(api.url, { headers });
            
            if (res.status === 404) {
                container.innerHTML = '<p class="text-muted mb-0">No solutions submitted yet. Be the first!</p>';
                return;
            }
            
            if (!res.ok) throw new Error("Failed to fetch cohort data.");
            
            const files = await res.json();
            
            if (!Array.isArray(files) || files.length === 0) {
                container.innerHTML = '<p class="text-muted mb-0">No solutions submitted yet.</p>';
                return;
            }

            container.innerHTML = '<ul class="list-group list-group-flush mb-0" id="cohort-list-' + problemId + '"></ul>';
            const listEl = container.querySelector('ul');

            for (const file of files) {
                if (!file.name.endsWith('.json')) continue;
                const username = file.name.replace('.json', '');
                
                const li = document.createElement('li');
                li.className = 'list-group-item bg-transparent px-0 border-0 mb-2';
                
                const userLink = document.createElement('a');
                userLink.href = 'javascript:void(0)';
                userLink.className = 'fw-bold text-dark text-decoration-none d-block p-2 bg-white rounded shadow-sm';
                
                const userText = document.createTextNode(`\uD83D\uDC64 ${username} `); // User emoji
                const viewSpan = document.createElement('span');
                viewSpan.className = 'text-muted float-end text-sm';
                viewSpan.textContent = 'View Solution';
                
                userLink.appendChild(userText);
                userLink.appendChild(viewSpan);
                
                const contentDiv = document.createElement('div');
                contentDiv.className = 'd-none mt-2 p-3 bg-white rounded border';
                contentDiv.innerHTML = '<div class="spinner-border spinner-border-sm text-primary" role="status"></div>';
                
                let loaded = false;
                userLink.onclick = async () => {
                    contentDiv.classList.toggle('d-none');
                    if (!loaded) {
                        contentDiv.innerHTML = ''; // Clear spinner safely
                        await this.loadSubmissionContent(contentDiv, problemId, username);
                        loaded = true;
                    }
                };
                
                li.appendChild(userLink);
                li.appendChild(contentDiv);
                listEl.appendChild(li);
            }
            
        } catch (e) {
            console.error(e);
            container.innerHTML = '<p class="text-danger mb-0">Failed to load cohort data. Rate limit or network error.</p>';
        }
    }

    async loadSubmissionContent(container, problemId, targetUsername) {
        try {
            const headers = await this.getGitHubHeaders();
            const cohortId = this.activeTopicConfig.cohort_id || 'default';
            const path = `cohort_data/${this.topic}/${cohortId}/${problemId}/${targetUsername}.json`;
            const api = this.getApiConfig(path);
            
            const res = await fetch(api.url, { headers });
            if (!res.ok) throw new Error("Failed to load file content.");
            
            const fileData = await res.json();
            const rawContent = decodeURIComponent(escape(atob(fileData.content)));
            const data = JSON.parse(rawContent);
            
            // The solution payload is nested inside data.solution_data now
            const decryptedSolutionData = await this.decryptPayload(JSON.stringify(data.solution_data || data));
            
            container.innerHTML = ''; // Clear safely

            const solutionDiv = document.createElement('div');
            const strongSol = document.createElement('strong');
            strongSol.textContent = 'Solution:';
            solutionDiv.appendChild(strongSol);
            solutionDiv.appendChild(document.createElement('br'));
            
            const pre = document.createElement('pre');
            pre.className = 'bg-light p-2 rounded mt-2 text-wrap';
            pre.style.fontFamily = 'inherit';
            pre.textContent = decryptedSolutionData.solution;
            
            solutionDiv.appendChild(pre);
            container.appendChild(solutionDiv);
            
            // Note: Commenting has been temporarily disabled due to authorization constraints 
            // identified in the security review.
        } catch (e) {
            console.error(e);
            container.innerHTML = '';
            const errorMsg = document.createElement('p');
            errorMsg.className = 'text-danger';
            errorMsg.textContent = 'Failed to load solution. Check passphrase.';
            container.appendChild(errorMsg);
        }
    }

    async proxyPutRequest(problemId, payload) {
        const encryptedSolution = await this.encryptPayload(payload);
        const headers = await this.getGitHubHeaders();
        
        if (this.activeTopicConfig.proxy_url) {
            const body = {
                action: 'cohort_publish_solution',
                topic: this.topic,
                problemId: problemId,
                solution_data: encryptedSolution,
                cohortId: this.activeTopicConfig.cohort_id
            };

            return await fetch(this.activeTopicConfig.proxy_url, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } else {
            throw new Error("Direct GitHub API publishing is disabled for security. Use Proxy.");
        }
    }

    async publishToCohort(problemId, content) {
        if (!content || content.trim() === '') {
            alert('Cannot publish empty solution.');
            return;
        }
        
        try {
            const btn = document.activeElement;
            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Publishing...';
            btn.disabled = true;

            // Notice we do NOT fetch the existing file or handle sha anymore.
            // All merge and identity behavior is strictly server-side.
            const putRes = await this.proxyPutRequest(problemId, { solution: content });
            
            if (putRes.ok) {
                btn.innerHTML = 'Published \u2713';
                btn.classList.replace('btn-outline-primary', 'btn-success');
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.classList.replace('btn-success', 'btn-outline-primary');
                    btn.disabled = false;
                    
                    const uiContainer = document.getElementById(`cohort-ui-${problemId}`);
                    if (uiContainer && !uiContainer.classList.contains('d-none')) {
                        this.fetchProblemSubmissions(problemId, uiContainer);
                    }
                }, 2000);
            } else {
                throw new Error(await putRes.text());
            }
        } catch (e) {
            console.error(e);
            alert("Failed to publish to cohort. Check console for details.");
            document.activeElement.innerHTML = 'Publish to Cohort';
            document.activeElement.disabled = false;
        }
    }

}

window.cohortManager = new CohortManager();
document.addEventListener('DOMContentLoaded', () => {
    window.cohortManager.init();
});
