let uploadedImages = [];
let currentImageIndex = 0;
let currentMockupId = null;

const imageUploadZone = document.getElementById('imageUploadZone');
const imageInput = document.getElementById('imageInput');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');

imageUploadZone.addEventListener('click', () => imageInput.click());
imageUploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    imageUploadZone.classList.add('dragover');
});
imageUploadZone.addEventListener('dragleave', () => imageUploadZone.classList.remove('dragover'));
imageUploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    imageUploadZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
});
imageInput.addEventListener('change', (e) => handleFiles(e.target.files));

function handleFiles(files) {
    Array.from(files).forEach(file => {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                uploadedImages.push(e.target.result);
                updateImagePreviews();
                updateMainDisplay();
            };
            reader.readAsDataURL(file);
        }
    });
}

function updateImagePreviews() {
    imagePreviewContainer.innerHTML = uploadedImages.map((img, index) => `
        <div class="image-preview" draggable="true" data-index="${index}">
            <img src="${img}">
            <button class="image-preview-remove" onclick="removeImage(${index})">✕</button>
        </div>
    `).join('');

    const previews = imagePreviewContainer.querySelectorAll('.image-preview');
    previews.forEach(preview => {
        preview.addEventListener('dragstart', (e) => draggedIndex = parseInt(e.target.dataset.index));
        preview.addEventListener('dragover', (e) => e.preventDefault());
        preview.addEventListener('drop', (e) => {
            e.preventDefault();
            const dropIndex = parseInt(e.currentTarget.dataset.index);
            if (draggedIndex !== null && draggedIndex !== dropIndex) {
                [uploadedImages[draggedIndex], uploadedImages[dropIndex]] = [uploadedImages[dropIndex], uploadedImages[draggedIndex]];
                updateImagePreviews();
                updateMainDisplay();
            }
        });
    });
}

function removeImage(index) {
    uploadedImages.splice(index, 1);
    updateImagePreviews();
    updateMainDisplay();
}

let draggedIndex = null;

function updateMainDisplay() {
    const mainImage = document.getElementById('mainImage');
    const thumbnailStrip = document.getElementById('thumbnailStrip');

    if (uploadedImages.length === 0) {
        mainImage.innerHTML = '<div class="placeholder-image"><div style="font-size:64px;">📦</div><div>Upload images</div></div>';
        thumbnailStrip.innerHTML = '';
        return;
    }

    mainImage.innerHTML = `<img src="${uploadedImages[currentImageIndex]}">`;
    thumbnailStrip.innerHTML = uploadedImages.map((img, index) => `
        <div class="thumbnail ${index === currentImageIndex ? 'active' : ''}" onclick="changeMainImage(${index})">
            <img src="${img}">
        </div>
    `).join('');
}

function changeMainImage(index) {
    currentImageIndex = index;
    updateMainDisplay();
}

document.getElementById('brandInput').addEventListener('input', (e) => {
    document.getElementById('displayBrand').textContent = e.target.value || 'Brand Name';
});

document.getElementById('titleInput').addEventListener('input', (e) => {
    document.getElementById('displayTitle').textContent = e.target.value || 'Product Title';
});

document.getElementById('priceInput').addEventListener('input', (e) => {
    document.getElementById('displayPrice').textContent = e.target.value ? `$${parseFloat(e.target.value).toFixed(2)}` : '$0.00';
});

document.getElementById('ratingInput').addEventListener('input', (e) => {
    const rating = parseFloat(e.target.value) || 0;
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    let stars = '★'.repeat(fullStars);
    if (hasHalfStar) stars += '☆';
    stars += '☆'.repeat(5 - fullStars - (hasHalfStar ? 1 : 0));
    document.getElementById('displayStars').textContent = stars;
});

document.getElementById('reviewsInput').addEventListener('input', (e) => {
    document.getElementById('displayRating').textContent = `(${e.target.value || 0})`;
});

document.getElementById('descriptionInput').addEventListener('input', (e) => {
    document.getElementById('displayDescription').textContent = e.target.value || 'Add description...';
});

function addBullet() {
    const bulletList = document.getElementById('bulletList');
    const newBullet = document.createElement('div');
    newBullet.className = 'bullet-item';
    newBullet.innerHTML = `<input type="text" placeholder="New feature" class="bullet-input"><button class="bullet-remove" onclick="removeBullet(this)">✕</button>`;
    bulletList.appendChild(newBullet);
    updateBulletDisplay();
}

function removeBullet(btn) {
    btn.parentElement.remove();
    updateBulletDisplay();
}

document.getElementById('bulletList').addEventListener('input', updateBulletDisplay);

function updateBulletDisplay() {
    const bullets = Array.from(document.querySelectorAll('.bullet-input')).map(i => i.value).filter(v => v.trim());
    const displayFeatures = document.getElementById('displayFeatures');
    displayFeatures.innerHTML = bullets.length === 0 ? '<li>Add features</li>' : bullets.map(b => `<li>${b}</li>`).join('');
}

function getMockupData() {
    return {
        brand: document.getElementById('brandInput').value,
        title: document.getElementById('titleInput').value,
        price: document.getElementById('priceInput').value,
        rating: document.getElementById('ratingInput').value,
        reviews: document.getElementById('reviewsInput').value,
        description: document.getElementById('descriptionInput').value,
        images: uploadedImages,
        bullets: Array.from(document.querySelectorAll('.bullet-input')).map(i => i.value)
    };
}

async function saveMockup() {
    const saveStatus = document.getElementById('saveStatus');
    saveStatus.textContent = 'Saving...';
    
    try {
        const data = getMockupData();
        const password = document.getElementById('passwordInput').value;
        
        let response;
        if (currentMockupId) {
            // Update existing
            response = await fetch(`/api/mockups/${currentMockupId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data, password: password || null })
            });
        } else {
            // Create new
            response = await fetch('/api/mockups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data, password: password || null })
            });
        }
        
        const result = await response.json();
        
        if (result.success) {
            if (!currentMockupId) {
                currentMockupId = result.id;
            }
            saveStatus.textContent = 'Saved!';
            saveStatus.classList.add('saved');
            setTimeout(() => {
                saveStatus.textContent = '';
                saveStatus.classList.remove('saved');
            }, 2000);
            
            const baseUrl = window.location.origin;
            document.getElementById('shareUrl').textContent = `${baseUrl}/mockup/${currentMockupId}`;
            document.getElementById('editUrl').textContent = `${baseUrl}/?id=${currentMockupId}${password ? '&pw=' + password : ''}`;
            document.getElementById('passwordNote').style.display = password ? 'inline' : 'none';
            document.getElementById('shareModal').classList.add('active');
        }
    } catch (error) {
        console.error('Error saving mockup:', error);
        saveStatus.textContent = 'Error saving';
        setTimeout(() => saveStatus.textContent = '', 2000);
    }
}

function copyUrl() {
    const url = document.getElementById('shareUrl').textContent;
    navigator.clipboard.writeText(url).then(() => {
        const btn = event.target;
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = original, 2000);
    });
}

function copyEditUrl() {
    const url = document.getElementById('editUrl').textContent;
    navigator.clipboard.writeText(url).then(() => {
        const btn = event.target;
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = original, 2000);
    });
}

function closeModal() {
    document.getElementById('shareModal').classList.remove('active');
}

function newMockup() {
    if (confirm('Start a new mockup? Current work will be cleared.')) {
        window.location.href = '/';
    }
}

function loadExisting() {
    document.getElementById('loadModal').classList.add('active');
}

function closeLoadModal() {
    document.getElementById('loadModal').classList.remove('active');
    document.getElementById('loadIdInput').value = '';
    document.getElementById('loadPasswordInput').value = '';
    document.getElementById('loadError').style.display = 'none';
}

async function submitLoad() {
    const input = document.getElementById('loadIdInput').value.trim();
    const password = document.getElementById('loadPasswordInput').value;
    
    if (!input) {
        document.getElementById('loadError').textContent = 'Please enter a mockup ID or URL';
        document.getElementById('loadError').style.display = 'block';
        return;
    }
    
    // Extract ID from URL or use as-is
    let id = input;
    if (input.includes('/mockup/')) {
        id = input.split('/mockup/')[1].split('?')[0];
    } else if (input.includes('?id=')) {
        id = new URLSearchParams(input.split('?')[1]).get('id');
    }
    
    try {
        const url = password ? `/api/mockups/${id}?password=${encodeURIComponent(password)}` : `/api/mockups/${id}`;
        const response = await fetch(url);
        const result = await response.json();
        
        if (!result.success) {
            document.getElementById('loadError').textContent = result.error || 'Failed to load mockup';
            document.getElementById('loadError').style.display = 'block';
            return;
        }
        
        // Load the data
        currentMockupId = id;
        const data = result.data;
        
        document.getElementById('brandInput').value = data.brand || '';
        document.getElementById('titleInput').value = data.title || '';
        document.getElementById('priceInput').value = data.price || '';
        document.getElementById('ratingInput').value = data.rating || '';
        document.getElementById('reviewsInput').value = data.reviews || '';
        document.getElementById('descriptionInput').value = data.description || '';
        document.getElementById('passwordInput').value = password || '';
        
        uploadedImages = data.images || [];
        updateImagePreviews();
        updateMainDisplay();
        
        // Load bullets
        const bulletList = document.getElementById('bulletList');
        bulletList.innerHTML = '';
        (data.bullets || ['']).forEach((bullet, i) => {
            const div = document.createElement('div');
            div.className = 'bullet-item';
            div.innerHTML = `<input type="text" placeholder="Feature ${i+1}" class="bullet-input" value="${bullet}"><button class="bullet-remove" onclick="removeBullet(this)">✕</button>`;
            bulletList.appendChild(div);
        });
        
        // Trigger all updates
        document.getElementById('brandInput').dispatchEvent(new Event('input'));
        document.getElementById('titleInput').dispatchEvent(new Event('input'));
        document.getElementById('priceInput').dispatchEvent(new Event('input'));
        document.getElementById('ratingInput').dispatchEvent(new Event('input'));
        document.getElementById('reviewsInput').dispatchEvent(new Event('input'));
        document.getElementById('descriptionInput').dispatchEvent(new Event('input'));
        updateBulletDisplay();
        
        closeLoadModal();
    } catch (error) {
        console.error('Error loading mockup:', error);
        document.getElementById('loadError').textContent = 'Error loading mockup';
        document.getElementById('loadError').style.display = 'block';
    }
}

// Check URL params on load
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const pw = params.get('pw');
    
    if (id) {
        document.getElementById('loadIdInput').value = id;
        if (pw) document.getElementById('loadPasswordInput').value = pw;
        submitLoad();
    }
});
