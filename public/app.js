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
        
        const response = await fetch('/api/mockups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data, password: password || null })
        });
        
        const result = await response.json();
        
        if (result.success) {
            currentMockupId = result.id;
            saveStatus.textContent = 'Saved!';
            saveStatus.classList.add('saved');
            setTimeout(() => {
                saveStatus.textContent = '';
                saveStatus.classList.remove('saved');
            }, 2000);
            
            document.getElementById('shareUrl').textContent = result.url;
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
        const btn = document.querySelector('.copy-btn');
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
        location.reload();
    }
}
