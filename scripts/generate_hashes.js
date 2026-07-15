const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NF_SET_THEORY_DIR = path.join(__dirname, '../nf-set-theory');
const OUTPUT_FILE = path.join(__dirname, '../versions.json');

// Helper to generate a short 8-character hex hash
function generateHash(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex').substring(0, 8);
}

function processDirectory() {
    const versions = {
        curriculum_master_hash: '',
        documents: {}
    };

    let totalCurriculumContent = '';

    const files = fs.readdirSync(NF_SET_THEORY_DIR);
    const qmdFiles = files.filter(f => f.endsWith('.qmd'));

    qmdFiles.forEach(file => {
        const filePath = path.join(NF_SET_THEORY_DIR, file);
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Hash for the entire document
        const docHash = generateHash(content);
        
        versions.documents[file] = {
            document_hash: docHash,
            problems: {}
        };

        totalCurriculumContent += content;

        // Extract individual problems and their hashes
        // We look for a card-header with the problem title, then the body up to the textarea
        const problemRegex = /\*\*(Problem [^*]+)\*\*[\s\S]*?<textarea id="([^"]+)"/g;
        let match;
        
        while ((match = problemRegex.exec(content)) !== null) {
            const problemTitle = match[1].trim();
            const problemId = match[2].trim();
            
            // The matched block contains the title and the body up to the textarea.
            // This is perfect for hashing, as any change in the prompt will change the hash.
            const problemBlock = match[0].trim();
            versions.documents[file].problems[problemId] = {
                title: problemTitle,
                hash: generateHash(problemBlock)
            };
        }
    });

    // Generate a master hash for the entire curriculum state
    versions.curriculum_master_hash = generateHash(totalCurriculumContent);
    versions.generated_at = new Date().toISOString();

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(versions, null, 2));
    console.log(`[Version Sync] Successfully generated versions.json with Master Hash: ${versions.curriculum_master_hash}`);
}

processDirectory();
