document.addEventListener('DOMContentLoaded', () => {
    // Only run on the homepage
    if (window.location.pathname !== '/' && window.location.pathname !== '/index.html') {
        return;
    }

    fetch('/cohort_config.json')
        .then(response => {
            if (!response.ok) throw new Error('Failed to load cohort config');
            return response.json();
        })
        .then(config => {
            if (!config.active_topics) return;

            const now = new Date();
            let hasActiveCohorts = false;
            const activeList = document.getElementById('active-cohorts-list');
            const activeContainer = document.getElementById('active-cohorts-container');

            config.active_topics.forEach(cohort => {
                const startDate = new Date(cohort.start_date);
                const endDate = new Date(cohort.end_date);
                endDate.setHours(23, 59, 59, 999); // Include full end day

                if (now >= startDate && now <= endDate) {
                    hasActiveCohorts = true;

                    // 1. Inject badge into the static list
                    const staticItem = document.querySelector(`.course-item[data-topic="${cohort.topic}"]`);
                    if (staticItem) {
                        const statusContainer = staticItem.querySelector('.cohort-status-container');
                        if (statusContainer) {
                            const badge = document.createElement('span');
                            badge.className = 'cohort-badge';
                            
                            // Format dates nicely (e.g., Jul 1 - Aug 31)
                            const startStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            badge.textContent = `Active Cohort: ${startStr} - ${endStr}`;
                            
                            statusContainer.appendChild(badge);
                        }
                    }

                    // 2. Clone into the top "Active Cohorts" section
                    if (staticItem && activeList) {
                        const clonedItem = staticItem.cloneNode(true);
                        activeList.appendChild(clonedItem);
                    }
                }
            });

            if (hasActiveCohorts && activeContainer) {
                activeContainer.classList.remove('d-none');
            }
        })
        .catch(err => console.error('Error loading cohort configurations:', err));
});
