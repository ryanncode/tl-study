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

    async fetchProblemSubmissions(problemId, container) {
        const targetRepo = this.activeTopicConfig.target_repo;
        const apiUrl = `https://api.github.com/repos/${targetRepo}/contents/cohort_data/${this.topic}/${problemId}`;
        
        try {
            const headers = await this.getGitHubHeaders();
            const res = await fetch(apiUrl, { headers });
            
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
                userLink.innerHTML = `👤 ${username} <span class="text-muted float-end text-sm">View Solution</span>`;
                
                const contentDiv = document.createElement('div');
                contentDiv.className = 'd-none mt-2 p-3 bg-white rounded border';
                contentDiv.innerHTML = '<div class="spinner-border spinner-border-sm text-primary" role="status"></div>';
                
                let loaded = false;
                userLink.onclick = async () => {
                    contentDiv.classList.toggle('d-none');
                    if (!loaded) {
                        await this.loadSubmissionContent(file.download_url, contentDiv, problemId, username, file.sha);
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

    async loadSubmissionContent(downloadUrl, container, problemId, targetUsername, fileSha) {
        try {
            const headers = await this.getGitHubHeaders();
            // Don't use Authorization header for raw.githubusercontent.com unless it's a private repo, 
            // but for safety we will fetch the content API instead of downloadUrl to ensure token works if needed.
            const targetRepo = this.activeTopicConfig.target_repo;
            const apiUrl = `https://api.github.com/repos/${targetRepo}/contents/cohort_data/${this.topic}/${problemId}/${targetUsername}.json`;
            
            const res = await fetch(apiUrl, { headers });
            if (!res.ok) throw new Error("Failed to load file content.");
            
            const fileData = await res.json();
            const data = JSON.parse(decodeURIComponent(escape(atob(fileData.content))));
            
            let html = `<div><strong>Solution:</strong><br><pre class="bg-light p-2 rounded mt-2 text-wrap" style="font-family: inherit;">${data.solution}</pre></div>`;
            
            html += `<div class="mt-4 border-top pt-3"><strong>Commentary:</strong>`;
            if (data.comments && data.comments.length > 0) {
                html += `<div class="mt-2">`;
                data.comments.forEach(c => {
                    html += `<div class="mb-2 p-2 bg-light rounded"><small class="fw-bold text-primary">${c.author}</small><p class="mb-0 mt-1 text-sm">${c.text}</p></div>`;
                });
                html += `</div>`;
            } else {
                html += `<p class="text-muted text-sm mt-2">No commentary yet.</p>`;
            }
            
            html += `
                <div class="mt-3">
                    <textarea id="comment-input-${problemId}-${targetUsername}" class="form-control form-control-sm mb-2" rows="2" placeholder="Add commentary..."></textarea>
                    <button class="btn btn-sm btn-secondary" onclick="window.cohortManager.submitCommentary('${problemId}', '${targetUsername}', '${fileData.sha}')">Post Comment</button>
                </div>
            </div>`;
            
            container.innerHTML = html;
        } catch (e) {
            console.error(e);
            container.innerHTML = '<p class="text-danger">Failed to load solution.</p>';
        }
    }

    async publishToCohort(problemId, content) {
        if (!content || content.trim() === '') {
            alert('Cannot publish empty solution.');
            return;
        }
        
        const username = window.tlStudySync ? window.tlStudySync.owner : prompt("Enter your GitHub username to publish as:");
        if (!username) return;

        const targetRepo = this.activeTopicConfig.target_repo;
        const apiUrl = `https://api.github.com/repos/${targetRepo}/contents/cohort_data/${this.topic}/${problemId}/${username}.json`;
        
        const headers = await this.getGitHubHeaders();
        
        // Check if exists to get SHA
        let sha = null;
        let existingComments = [];
        try {
            const checkRes = await fetch(apiUrl, { headers });
            if (checkRes.ok) {
                const existingFile = await checkRes.json();
                sha = existingFile.sha;
                const existingData = JSON.parse(decodeURIComponent(escape(atob(existingFile.content))));
                if (existingData.comments) existingComments = existingData.comments;
            }
        } catch(e) {}
        
        const payload = {
            solution: content,
            updated_at: new Date().toISOString(),
            comments: existingComments
        };
        
        const body = {
            message: `Publish solution for ${problemId} by ${username}`,
            content: btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))))
        };
        if (sha) body.sha = sha;

        try {
            const btn = document.activeElement;
            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Publishing...';
            btn.disabled = true;

            const putRes = await fetch(apiUrl, {
                method: 'PUT',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            
            if (putRes.ok) {
                btn.innerHTML = 'Published \u2713';
                btn.classList.replace('btn-outline-primary', 'btn-success');
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.classList.replace('btn-success', 'btn-outline-primary');
                    btn.disabled = false;
                    
                    // Refresh UI if expanded
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

    async submitCommentary(problemId, targetUsername, fileSha) {
        const commentInput = document.getElementById(`comment-input-${problemId}-${targetUsername}`);
        const commentText = commentInput.value;
        
        if (!commentText || commentText.trim() === '') return;
        
        const authorUsername = window.tlStudySync ? window.tlStudySync.owner : prompt("Enter your GitHub username to comment as:");
        if (!authorUsername) return;

        const targetRepo = this.activeTopicConfig.target_repo;
        const apiUrl = `https://api.github.com/repos/${targetRepo}/contents/cohort_data/${this.topic}/${problemId}/${targetUsername}.json`;
        
        const headers = await this.getGitHubHeaders();
        
        try {
            const btn = document.activeElement;
            btn.disabled = true;
            btn.innerHTML = 'Posting...';

            // Fetch latest content to ensure we don't overwrite other concurrent comments
            const getRes = await fetch(apiUrl, { headers });
            if (!getRes.ok) throw new Error("Failed to fetch latest file state.");
            const fileData = await getRes.json();
            const data = JSON.parse(decodeURIComponent(escape(atob(fileData.content))));
            
            if (!data.comments) data.comments = [];
            data.comments.push({
                author: authorUsername,
                text: commentText,
                timestamp: new Date().toISOString()
            });

            const body = {
                message: `Add commentary by ${authorUsername} on ${targetUsername}'s solution to ${problemId}`,
                content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
                sha: fileData.sha
            };

            const putRes = await fetch(apiUrl, {
                method: 'PUT',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            
            if (putRes.ok) {
                // Refresh the specific user's expansion panel
                const contentDiv = commentInput.closest('.p-3.bg-white.rounded.border');
                this.loadSubmissionContent(fileData.download_url, contentDiv, problemId, targetUsername, (await putRes.json()).content.sha);
            } else {
                throw new Error(await putRes.text());
            }
        } catch (e) {
            console.error(e);
            alert("Failed to post commentary.");
            const btn = document.activeElement;
            btn.disabled = false;
            btn.innerHTML = 'Post Comment';
        }
    }
}

window.cohortManager = new CohortManager();
document.addEventListener('DOMContentLoaded', () => {
    window.cohortManager.init();
});
