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
    this.innerHTML = `
      <div class="card mb-4 bg-light">
        <div class="card-body">
          <h5 class="card-title">Interactive Syntax Sandbox</h5>
          <p class="card-text text-muted small">Experiment with constructing formal syntax strings. This area is for free exploration and will not be saved.</p>
          <textarea class="form-control mb-3 syntax-textarea" rows="3" placeholder="Construct your syntax here..."></textarea>
          <div class="d-flex flex-wrap gap-2 button-container">
          </div>
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
    groups.forEach(group => {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'btn-group';
      
      group.forEach(item => {
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
      btnContainer.appendChild(groupDiv);
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
