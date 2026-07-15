/**
 * priority-nav.js
 * 
 * Replicates the Ghost CMS "progressive collapse" navigation behavior.
 * As the window shrinks, left-side navigation items are moved one-by-one into a "..." dropdown.
 * At the Bootstrap mobile breakpoint, it falls back to the native hamburger menu.
 */

document.addEventListener('DOMContentLoaded', () => {
    const navbar = document.querySelector('#quarto-header .navbar');
    const container = document.querySelector('#quarto-header .navbar-container');
    const leftNav = document.querySelector('#quarto-header .navbar-nav.me-auto');
    const rightNav = document.querySelector('#quarto-header .navbar-nav.ms-auto');
    const brand = document.querySelector('#quarto-header .navbar-brand-container');
    
    if (!leftNav || !container) return;

    // Create the "More" dropdown
    const moreLi = document.createElement('li');
    moreLi.className = 'nav-item dropdown d-none'; // Hidden by default
    moreLi.id = 'gh-more-toggle-li';
    moreLi.innerHTML = `
        <a class="nav-link" href="#" id="navbarMoreDropdown" role="button" data-bs-toggle="dropdown" aria-expanded="false" style="display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0 !important; margin: 0 !important;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="currentColor" width="20" height="20">
                <path d="M21.333 16c0-1.473 1.194-2.667 2.667-2.667v0c1.473 0 2.667 1.194 2.667 2.667v0c0 1.473-1.194 2.667-2.667 2.667v0c-1.473 0-2.667-1.194-2.667-2.667v0zM13.333 16c0-1.473 1.194-2.667 2.667-2.667v0c1.473 0 2.667 1.194 2.667 2.667v0c0 1.473-1.194 2.667-2.667 2.667v0c-1.473 0-2.667-1.194-2.667-2.667v0zM5.333 16c0-1.473 1.194-2.667 2.667-2.667v0c1.473 0 2.667 1.194 2.667 2.667v0c0 1.473-1.194 2.667-2.667 2.667v0c-1.473 0-2.667-1.194-2.667-2.667v0z"></path>
            </svg>
        </a>
        <ul class="dropdown-menu dropdown-menu-end shadow-sm border-0" aria-labelledby="navbarMoreDropdown" id="gh-more-dropdown-menu" style="background-color: #4a5568;">
        </ul>
    `;
    leftNav.appendChild(moreLi);

    const dropdownMenu = moreLi.querySelector('.dropdown-menu');
    
    // Store original widths to know when to restore
    const itemWidths = [];
    const navItems = Array.from(leftNav.children).filter(el => el.id !== 'gh-more-toggle-li');
    
    navItems.forEach(item => {
        // Force a calculation by making sure it's not hidden
        itemWidths.push({
            el: item,
            width: item.offsetWidth + 24 // Include the 24px flex gap
        });
    });

    let hiddenItems = [];

    function checkNav() {
        // If the mobile hamburger menu is active (window width < Bootstrap SM breakpoint), reset everything
        const isMobile = window.innerWidth < 576;
        if (isMobile) {
            // Restore all
            while(hiddenItems.length > 0) {
                const item = hiddenItems.pop();
                leftNav.insertBefore(item.el, moreLi);
                item.el.querySelector('.nav-link').classList.remove('dropdown-item');
                item.el.querySelector('.nav-link').style.color = 'rgba(255, 255, 255, 0.85)';
            }
            moreLi.classList.add('d-none');
            return;
        }

        const containerWidth = container.offsetWidth;
        const brandWidth = brand ? brand.offsetWidth : 0;
        const rightNavWidth = rightNav ? rightNav.offsetWidth : 0;
        
        // Available width for the left links: container - brand - rightNav - padding/margins
        // We leave a generous buffer of 100px for safety and the toggle button
        const availableWidth = containerWidth - brandWidth - rightNavWidth - 100;
        
        // Calculate current width of visible left nav items
        let currentWidth = 0;
        const visibleItems = Array.from(leftNav.children).filter(el => el.id !== 'gh-more-toggle-li' && !el.classList.contains('d-none'));
        visibleItems.forEach(item => {
            currentWidth += item.offsetWidth + 24; // Including gap
        });

        // 1. If we overflow, move items to dropdown
        if (currentWidth > availableWidth && visibleItems.length > 0) {
            moreLi.classList.remove('d-none');
            
            while (currentWidth > availableWidth && visibleItems.length > 0) {
                const lastItem = visibleItems.pop();
                hiddenItems.push({
                    el: lastItem,
                    width: lastItem.offsetWidth + 24
                });
                
                // Style for dropdown
                const link = lastItem.querySelector('.nav-link');
                link.classList.add('dropdown-item');
                // Ghost styling for dropdown items
                link.style.color = '#ffffff'; 
                link.style.padding = '8px 16px !important';
                
                dropdownMenu.insertBefore(lastItem, dropdownMenu.firstChild);
                currentWidth -= (lastItem.offsetWidth + 24);
            }
        }
        
        // 2. If we have extra space, restore items from dropdown
        if (hiddenItems.length > 0) {
            let nextItem = hiddenItems[hiddenItems.length - 1];
            while (nextItem && (currentWidth + nextItem.width) < availableWidth) {
                nextItem = hiddenItems.pop();
                
                // Restore styling
                const link = nextItem.el.querySelector('.nav-link');
                link.classList.remove('dropdown-item');
                link.style.padding = '0 !important';
                
                leftNav.insertBefore(nextItem.el, moreLi);
                currentWidth += nextItem.width;
                
                nextItem = hiddenItems.length > 0 ? hiddenItems[hiddenItems.length - 1] : null;
            }
            
            if (hiddenItems.length === 0) {
                moreLi.classList.add('d-none');
            }
        }
    }

    // Run on load and resize
    window.addEventListener('resize', checkNav);
    
    // Initial calculation needs a small delay to ensure fonts/CSS are fully rendered
    setTimeout(checkNav, 100);
});
