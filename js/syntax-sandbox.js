class SyntaxSandbox extends HTMLElement {
  constructor() {
    super();
    this.tokens = []; // now stores objects: { val: "x", spaceBefore: true, spaceAfter: true }
  }

  connectedCallback() {
    const groupsRaw = this.getAttribute('data-groups') || '[]';
    let groups = [];
    try {
      groups = JSON.parse(groupsRaw);
    } catch (e) {
      console.error("Invalid data-groups JSON in syntax-sandbox", e);
    }

    this.render(groups);
  }

  render(groups) {
    const isProblem = this.hasAttribute('problem-id');
    const problemId = this.getAttribute('problem-id');
    const title = this.getAttribute('title') || (isProblem ? 'Problem' : 'Interactive Sandbox');
    const description = this.getAttribute('description') || (isProblem ? '' : 'This area is for free exploration and will not be saved.');
    
    const cardClass = isProblem ? 'card mb-4' : 'card mb-4 bg-light';
    const headerHtml = isProblem ? `<div class="card-header bg-primary text-white"><strong>${title}</strong></div>` : '';
    const titleHtml = isProblem ? '' : `<h5 class="card-title">${title}</h5>`;
    const descHtml = description ? `<p class="card-text ${isProblem ? 'mb-3' : 'text-muted small'}">${description}</p>` : '';
    
    const textareaId = isProblem ? `id="${problemId}"` : '';
    const textareaClass = isProblem ? 'form-control mb-3 syntax-textarea problem-input' : 'form-control mb-3 syntax-textarea';
    
    const saveBtnHtml = isProblem ? `<button class="btn btn-success mt-3" onclick="window.tlStudySync.saveData()">Save to GitHub</button>` : '';

    this.innerHTML = `
      <div class="${cardClass}">
        ${headerHtml}
        <div class="card-body">
          ${titleHtml}
          ${descHtml}
          <textarea ${textareaId} class="${textareaClass}" rows="3" placeholder="Enter your response here..."></textarea>
          <div class="d-flex flex-wrap gap-2 button-container">
          </div>
          ${saveBtnHtml}
        </div>
      </div>
    `;

    const textarea = this.querySelector('.syntax-textarea');
    const btnContainer = this.querySelector('.button-container');

    const updateTextarea = () => {
      let str = "";
      for (let i = 0; i < this.tokens.length; i++) {
        const t = this.tokens[i];
        const next = this.tokens[i + 1];
        
        str += t.val;
        
        if (next) {
          const thisSpaceAfter = t.spaceAfter !== false;
          const nextSpaceBefore = next.spaceBefore !== false;
          // Add space only if BOTH tokens permit it
          if (thisSpaceAfter && nextSpaceBefore) {
            str += " ";
          }
        }
      }
      textarea.value = str;
    };

    // Render button groups
    groups.forEach(groupConfig => {
      let groupArray = groupConfig;
      let label = null;
      if (typeof groupConfig === 'object' && !Array.isArray(groupConfig) && groupConfig.buttons) {
        groupArray = groupConfig.buttons;
        label = groupConfig.label;
      }

      const groupWrapper = document.createElement('div');
      groupWrapper.className = 'd-flex flex-column align-items-center me-3 mb-2';

      if (label) {
        const labelEl = document.createElement('small');
        labelEl.className = 'text-muted fw-bold mb-1';
        labelEl.style.fontSize = '0.75rem';
        labelEl.textContent = label.toUpperCase();
        groupWrapper.appendChild(labelEl);
      }

      const groupDiv = document.createElement('div');
      groupDiv.className = 'btn-group shadow-sm';
      
      groupArray.forEach(item => {
        // Normalize item to object format
        const tokenObj = typeof item === 'string' ? { val: item.trim() } : item;
        
        const btn = document.createElement('button');
        btn.className = 'btn btn-outline-secondary btn-sm';
        btn.textContent = tokenObj.val || ' ';
        btn.onclick = () => {
          this.tokens.push(tokenObj);
          updateTextarea();
        };
        groupDiv.appendChild(btn);
      });
      groupWrapper.appendChild(groupDiv);
      btnContainer.appendChild(groupWrapper);
    });

    // Add control buttons
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'ms-auto d-flex gap-2';

    const backspaceBtn = document.createElement('button');
    backspaceBtn.className = 'btn btn-outline-warning btn-sm';
    backspaceBtn.innerHTML = '&#9003; Backspace'; // HTML entity for backspace
    backspaceBtn.onclick = () => {
      this.tokens.pop();
      updateTextarea();
    };

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-outline-danger btn-sm';
    clearBtn.textContent = 'Clear';
    clearBtn.onclick = () => {
      this.tokens = [];
      updateTextarea();
    };

    controlsDiv.appendChild(backspaceBtn);
    controlsDiv.appendChild(clearBtn);
    btnContainer.appendChild(controlsDiv);
    
    // Support manual typing by tracking changes
    textarea.addEventListener('input', (e) => {
        // Flatten into a single monolithic token so backspace deletes the whole manual edit
        this.tokens = [{ val: e.target.value, spaceAfter: false, spaceBefore: false }]; 
    });
  }
}

customElements.define('syntax-sandbox', SyntaxSandbox);
