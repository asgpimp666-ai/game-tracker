// ============================================
// GAMETRACKER - С ПОДДЕРЖКОЙ НАСТОЛЬНЫХ ИГР
// ============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore,
    collection,
    addDoc,
    getDocs,
    query,
    where,
    orderBy,
    doc,
    updateDoc,
    deleteDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Конфигурация Firebase
const firebaseConfig = {
    apiKey: "AIzaSyBtzV5ZNWxu2D1UqnVlP9h4HhJBFuIhT7Q",
    authDomain: "gametest-527fc.firebaseapp.com",
    projectId: "gametest-527fc",
    storageBucket: "gametest-527fc.firebasestorage.app",
    messagingSenderId: "267688906934",
    appId: "1:267688906934:web:9d62af1ff3a7d80f815617"
};

// API ключи и токены
const API_CONFIG = {
    IMGBB: "a8e8e6c1e0a8e8e6c1e0a8e8e6c1e0a8",
    RAWG_ALTERNATIVE: "3d5f4e3a7d3d4b6d8e5f6c7a8b9c0d1e2",
    BOARDGAME_GEEK_TOKEN: "455fab85-6830-471d-94ed-e71c059fbea3", // Ваш токен
    CORS_PROXY: "https://api.allorigins.win/raw?url=",
    CORS_PROXY_2: "https://corsproxy.io/?",
    STEAM_API: null
};

// Инициализация
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Глобальные переменные
let currentUser = null;
let selectedPlatforms = [];
let selectedGameType = 'video'; // 'video' или 'board'
let currentImageUrl = '';
let currentImageSource = '';
let currentSearchResults = [];
let selectedSearchResult = null;
let imgbbApiKey = API_CONFIG.IMGBB;
let currentUploadFile = null;

// ====================
// УТИЛИТЫ ДЛЯ API
// ====================
async function fetchWithRetry(url, options = {}, retries = 3) {
  // Используем CORS прокси
  const corsUrl = `${API_CONFIG.CORS_PROXY_2}${encodeURIComponent(url)}`; // ← corsproxy.io

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(corsUrl, options);

      // Если BGG говорит "повторите позже"
      if (response.status === 202) {
        console.log(`Получен статус 202 от BGG. Повтор через 5 секунд... (попытка ${attempt + 1})`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue; // повторяем
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response; // успех
    } catch (error) {
      if (attempt < retries) {
        console.log(`Ошибка сети. Повтор через 1 сек... (осталось ${retries - attempt - 1})`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        throw error;
      }
    }
  }
}

// ====================
// ТЕМЫ ОФОРМЛЕНИЯ
// ====================
function initTheme() {
    const savedTheme = localStorage.getItem('app_theme') || 'xbox';
    changeTheme(savedTheme);
}

function changeTheme(themeName) {
    const themes = {
        xbox: {
            primary: '#107c10',
            primaryDark: '#0e700e',
            accent: '#9bf00b'
        },
        playstation: {
            primary: '#0066cc',
            primaryDark: '#003399',
            accent: '#ffffff'
        },
        nintendo: {
            primary: '#e60012',
            primaryDark: '#b3000e',
            accent: '#ffffff'
        },
        steam: {
            primary: '#1b2838',
            primaryDark: '#171a21',
            accent: '#66c0f4'
        }
    };
    
    const theme = themes[themeName] || themes.xbox;
    
    localStorage.setItem('app_theme', themeName);
    document.documentElement.style.setProperty('--primary', theme.primary);
    document.documentElement.style.setProperty('--primary-dark', theme.primaryDark);
    document.documentElement.style.setProperty('--accent', theme.accent);
    
    document.querySelectorAll('.theme-card').forEach(card => {
        card.classList.remove('active');
        if (card.dataset.theme === themeName) {
            card.classList.add('active');
        }
    });
}

// ====================
// НАСТРОЙКИ IMGBB
// ====================
function saveImgBBKey() {
    const keyInput = document.getElementById('imgbb-api-key');
    if (!keyInput) return;
    
    const key = keyInput.value.trim();
    
    if (key && key.length > 20) {
        localStorage.setItem('imgbb_api_key', key);
        imgbbApiKey = key;
        showNotification('API ключ ImgBB сохранен', 'success');
        
        const maskedKey = key.substring(0, 4) + '...' + key.substring(key.length - 4);
        keyInput.value = maskedKey;
        keyInput.type = 'password';
    } else if (key === '') {
        localStorage.removeItem('imgbb_api_key');
        imgbbApiKey = API_CONFIG.IMGBB;
        showNotification('Используется демо-ключ ImgBB', 'info');
    } else {
        showNotification('Некорректный API ключ', 'error');
    }
}

function updateImgBBKeyField() {
    const keyInput = document.getElementById('imgbb-api-key');
    if (!keyInput) return;
    
    const savedKey = localStorage.getItem('imgbb_api_key');
    if (savedKey) {
        const maskedKey = savedKey.substring(0, 4) + '...' + savedKey.substring(savedKey.length - 4);
        keyInput.value = maskedKey;
        keyInput.type = 'password';
    } else {
        keyInput.value = '';
        keyInput.type = 'text';
    }
}

// ====================
// ПАРСИНГ ОБЛОЖЕК - ОБНОВЛЕННЫЙ ДЛЯ НАСТОЛЬНЫХ ИГР
// ====================
async function searchGameCovers(gameName, source = 'all') {
    try {
        const searchContainer = document.getElementById('search-results');
        if (!searchContainer) return;
        
        searchContainer.innerHTML = `
            <div class="search-loading">
                <div class="loading-spinner"></div>
                <p style="margin-top: 0.5rem;">Поиск обложек...</p>
            </div>
        `;
        
        const results = [];
        const searchPromises = [];
        
        // В зависимости от типа игры используем разные источники
        if (selectedGameType === 'video') {
            // Для видеоигр
            searchPromises.push(generateVideoGameCovers(gameName, source));
            
            if (source === 'all' || source === 'steam') {
                searchPromises.push(searchSteamCovers(gameName));
            }
            
            if (source === 'all' || source === 'xbox') {
                searchPromises.push(searchXboxCovers(gameName));
            }
            
            if (source === 'all' || source === 'playstation') {
                searchPromises.push(searchPlayStationCovers(gameName));
            }
            
            if (source === 'all' || source === 'nintendo') {
                searchPromises.push(searchNintendoCovers(gameName));
            }
            
            // Rawg.io для видеоигр
            searchPromises.push(searchRawgCovers(gameName));
            
        } else {
            // Для настольных игр
            searchPromises.push(generateBoardGameCovers(gameName));
            searchPromises.push(searchBoardGameGeekCovers(gameName));
        }
        
        const allResults = await Promise.allSettled(searchPromises);
        
        allResults.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                results.push(...result.value);
            }
        });
        
        // Убираем дубликаты
        const uniqueResults = [];
        const seenUrls = new Set();
        
        results.forEach(result => {
            if (result.url && !seenUrls.has(result.url)) {
                seenUrls.add(result.url);
                uniqueResults.push(result);
            }
        });
        
        currentSearchResults = uniqueResults;
        displaySearchResults(uniqueResults);
        
        if (uniqueResults.length === 0) {
            showNotification('Обложки не найдены. Используются сгенерированные изображения.', 'info');
        }
        
    } catch (error) {
        console.error("Ошибка поиска обложек:", error);
        
        // Показываем сгенерированные обложки
        const generatedResults = selectedGameType === 'video' 
            ? await generateVideoGameCovers(gameName, source)
            : await generateBoardGameCovers(gameName);
            
        currentSearchResults = generatedResults;
        displaySearchResults(generatedResults);
        
        showNotification('Используются сгенерированные обложки', 'info');
    }
}

async function generateVideoGameCovers(gameName, source = 'all') {
    const results = [];
    
    if (source === 'all' || source === 'steam') {
        results.push({
            url: generateSteamStyleImage(gameName),
            thumbnail: generateSteamStyleImage(gameName, true),
            title: `${gameName} (Steam)`,
            source: 'Steam',
            sourceIcon: 'fab fa-steam',
            gameType: 'video'
        });
    }
    
    if (source === 'all' || source === 'xbox') {
        results.push({
            url: generateXboxStyleImage(gameName),
            thumbnail: generateXboxStyleImage(gameName, true),
            title: `${gameName} (Xbox)`,
            source: 'Xbox Store',
            sourceIcon: 'fab fa-xbox',
            gameType: 'video'
        });
    }
    
    if (source === 'all' || source === 'playstation') {
        results.push({
            url: generatePlayStationStyleImage(gameName),
            thumbnail: generatePlayStationStyleImage(gameName, true),
            title: `${gameName} (PlayStation)`,
            source: 'PlayStation Store',
            sourceIcon: 'fab fa-playstation',
            gameType: 'video'
        });
    }
    
    if (source === 'all' || source === 'nintendo') {
        results.push({
            url: generateNintendoStyleImage(gameName),
            thumbnail: generateNintendoStyleImage(gameName, true),
            title: `${gameName} (Nintendo)`,
            source: 'Nintendo eShop',
            sourceIcon: 'fas fa-gamepad',
            gameType: 'video'
        });
    }
    
    // Добавляем общую обложку для видеоигр
    results.push({
        url: generateVideoGameImage(gameName),
        thumbnail: generateVideoGameImage(gameName),
        title: gameName,
        source: 'GameTracker',
        sourceIcon: 'fas fa-gamepad',
        gameType: 'video'
    });
    
    return results;
}

async function generateBoardGameCovers(gameName) {
    const results = [];
    
    // Генерируем разные стили для настольных игр
    const boardStyles = ['classic', 'modern', 'fantasy', 'strategy'];
    
    boardStyles.forEach(style => {
        results.push({
            url: generateBoardGameImage(gameName, style),
            thumbnail: generateBoardGameImage(gameName, style, true),
            title: `${gameName} (${getBoardGameStyleName(style)})`,
            source: 'Board Game Generator',
            sourceIcon: 'fas fa-chess-board',
            gameType: 'board',
            style: style
        });
    });
    
    // Добавляем общую обложку
    results.push({
        url: generateBoardGameImage(gameName),
        thumbnail: generateBoardGameImage(gameName, 'classic', true),
        title: gameName,
        source: 'Board Game',
        sourceIcon: 'fas fa-dice',
        gameType: 'board'
    });
    
    return results;
}

function getBoardGameStyleName(style) {
    const styles = {
        'classic': 'Классика',
        'modern': 'Модерн',
        'fantasy': 'Фэнтези',
        'strategy': 'Стратегия'
    };
    return styles[style] || style;
}

// ====================
// BOARDGAME GEEK API
// ====================
async function searchBoardGameGeekCovers(gameName) {
    try {
        // BoardGameGeek XML API
        const encodedName = encodeURIComponent(gameName);
        const url = `https://boardgamegeek.com/xmlapi2/search?query=${encodedName}&type=boardgame`;
        
        const response = await fetchWithRetry(url);
        const text = await response.text();
        
        // Парсим XML ответ
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");
        
        const items = xmlDoc.getElementsByTagName('item');
        const games = [];
        
        // Ограничиваем 5 результатами
        for (let i = 0; i < Math.min(items.length, 5); i++) {
            const item = items[i];
            const id = item.getAttribute('id');
            const name = item.getElementsByTagName('name')[0]?.getAttribute('value') || gameName;
            
            // Получаем детальную информацию об игре
            const details = await getBoardGameGeekDetails(id);
            if (details) {
                games.push(details);
            }
        }
        
        return games;
        
    } catch (error) {
        console.error("Ошибка поиска в BoardGameGeek:", error);
        return [];
    }
}

async function getBoardGameGeekDetails(gameId) {
    try {
        const url = `https://boardgamegeek.com/xmlapi2/thing?id=${gameId}`;
        const response = await fetchWithRetry(url);
        const text = await response.text();
        
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");
        
        const item = xmlDoc.getElementsByTagName('item')[0];
        if (!item) return null;
        
        const name = item.getElementsByTagName('name')[0]?.getAttribute('value') || 'Неизвестно';
        const year = item.getElementsByTagName('yearpublished')[0]?.getAttribute('value') || '';
        const description = item.getElementsByTagName('description')[0]?.textContent || '';
        
        // Ищем изображение
        let imageUrl = '';
        const imageElement = item.getElementsByTagName('image')[0];
        if (imageElement) {
            imageUrl = imageElement.textContent;
        }
        
        // Если нет изображения, генерируем
        if (!imageUrl) {
            imageUrl = generateBoardGameImage(name);
        }
        
        // Получаем жанры/категории
        const categories = [];
        const categoryElements = xmlDoc.getElementsByTagName('link');
        for (let element of categoryElements) {
            if (element.getAttribute('type') === 'boardgamecategory') {
                categories.push(element.getAttribute('value'));
            }
        }
        
        // Рейтинг
        const ratingElement = item.getElementsByTagName('average')[0];
        const rating = ratingElement ? parseFloat(ratingElement.getAttribute('value')).toFixed(1) : 'N/A';
        
        return {
            url: imageUrl,
            thumbnail: imageUrl,
            title: name,
            source: 'BoardGameGeek',
            sourceIcon: 'fas fa-chess',
            gameType: 'board',
            year: year,
            description: description.substring(0, 100) + '...',
            categories: categories.slice(0, 3).join(', '),
            rating: rating,
            bggId: gameId
        };
        
    } catch (error) {
        console.error("Ошибка получения деталей игры:", error);
        return null;
    }
}

// ====================
// ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЙ ДЛЯ НАСТОЛЬНЫХ ИГР
// ====================
function generateBoardGameImage(gameName, style = 'classic', isThumbnail = false) {
    const styles = {
        classic: {
            colors: [
                ['#8B4513', '#A0522D'], // Коричневые тона
                ['#D2691E', '#8B4513'],
                ['#A0522D', '#D2691E']
            ],
            icon: '♟️',
            pattern: 'dice'
        },
        modern: {
            colors: [
                ['#2196F3', '#1976D2'], // Синие тона
                ['#00BCD4', '#0097A7'],
                ['#3F51B5', '#303F9F']
            ],
            icon: '🎲',
            pattern: 'modern'
        },
        fantasy: {
            colors: [
                ['#9C27B0', '#7B1FA2'], // Фиолетовые тона
                ['#673AB7', '#512DA8'],
                ['#E91E63', '#C2185B']
            ],
            icon: '🏰',
            pattern: 'fantasy'
        },
        strategy: {
            colors: [
                ['#4CAF50', '#388E3C'], // Зеленые тона
                ['#FF9800', '#F57C00'],
                ['#795548', '#5D4037']
            ],
            icon: '♚',
            pattern: 'strategy'
        }
    };
    
    const styleConfig = styles[style] || styles.classic;
    const hash = gameName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const [color1, color2] = styleConfig.colors[hash % styleConfig.colors.length];
    
    const width = isThumbnail ? 231 : 460;
    const height = isThumbnail ? 87 : 215;
    
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
            <defs>
                <linearGradient id="boardGrad${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${color1}" />
                    <stop offset="100%" stop-color="${color2}" />
                </linearGradient>
                <filter id="boardShadow${hash}">
                    <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.3"/>
                </filter>
                <pattern id="dicePattern${hash}" width="20" height="20" patternUnits="userSpaceOnUse">
                    <circle cx="10" cy="10" r="2" fill="white" opacity="0.2"/>
                </pattern>
                <pattern id="chessPattern${hash}" width="40" height="40" patternUnits="userSpaceOnUse">
                    <rect width="20" height="20" fill="white" opacity="0.1"/>
                    <rect x="20" y="20" width="20" height="20" fill="white" opacity="0.1"/>
                </pattern>
            </defs>
            <rect width="${width}" height="${height}" fill="url(#boardGrad${hash})"/>
            ${styleConfig.pattern === 'dice' ? `<rect width="${width}" height="${height}" fill="url(#dicePattern${hash})"/>` : ''}
            ${styleConfig.pattern === 'strategy' ? `<rect width="${width}" height="${height}" fill="url(#chessPattern${hash})"/>` : ''}
            <text x="${width/2}" y="${height/2 - 10}" 
                  font-family="Arial, sans-serif" 
                  font-size="${isThumbnail ? 14 : 28}" 
                  font-weight="bold" 
                  fill="white" 
                  text-anchor="middle"
                  filter="url(#boardShadow${hash})">
                ${styleConfig.icon} ${gameName.substring(0, isThumbnail ? 12 : 24)}
            </text>
            <text x="${width/2}" y="${height/2 + (isThumbnail ? 15 : 30)}" 
                  font-family="Arial, sans-serif" 
                  font-size="${isThumbnail ? 8 : 12}" 
                  fill="rgba(255,255,255,0.8)" 
                  text-anchor="middle">
                ${style === 'classic' ? 'Настольная игра' : 'Board Game'}
            </text>
        </svg>
    `;
    
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

function generateVideoGameImage(gameName) {
    const colors = [
        ['#107c10', '#0e700e'],
        ['#0066cc', '#003399'],
        ['#e60012', '#b3000e'],
        ['#1b2838', '#171a21']
    ];
    
    const hash = gameName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const [color1, color2] = colors[hash % colors.length];
    
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
            <defs>
                <linearGradient id="videogameGrad${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${color1}" />
                    <stop offset="100%" stop-color="${color2}" />
                </linearGradient>
                <filter id="videogameShadow${hash}">
                    <feDropShadow dx="0" dy="4" stdDeviation="8" flood-opacity="0.3"/>
                </filter>
            </defs>
            <rect width="400" height="600" fill="url(#videogameGrad${hash})"/>
            <text x="200" y="300" 
                  font-family="Arial, sans-serif" 
                  font-size="28" 
                  font-weight="bold" 
                  fill="white" 
                  text-anchor="middle"
                  filter="url(#videogameShadow${hash})">
                ${gameName.substring(0, 20)}
            </text>
            <text x="200" y="340" 
                  font-family="Arial, sans-serif" 
                  font-size="16" 
                  fill="rgba(255,255,255,0.7)" 
                  text-anchor="middle">
                Video Game
            </text>
        </svg>
    `;
    
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

// ====================
// ФУНКЦИИ ДЛЯ ВИДЕОИГР (остаются как были)
// ====================
async function searchSteamCovers(gameName) {
    try {
        const encodedName = encodeURIComponent(gameName);
        const response = await fetchWithRetry(
            `https://api.steampowered.com/ISteamApps/GetAppList/v2/`
        );
        
        const data = await response.json();
        const games = [];
        
        const matches = data.applist.apps.filter(app => 
            app.name.toLowerCase().includes(gameName.toLowerCase())
        ).slice(0, 5);
        
        matches.forEach(app => {
            games.push({
                url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${app.appid}/header.jpg`,
                thumbnail: `https://cdn.cloudflare.steamstatic.com/steam/apps/${app.appid}/capsule_231x87.jpg`,
                title: app.name,
                source: 'Steam',
                sourceIcon: 'fab fa-steam',
                gameType: 'video',
                appId: app.appid
            });
        });
        
        return games;
        
    } catch (error) {
        console.error("Ошибка поиска в Steam:", error);
        return [];
    }
}

async function searchXboxCovers(gameName) {
    try {
        return [{
            url: generateXboxStyleImage(gameName),
            thumbnail: generateXboxStyleImage(gameName, true),
            title: `${gameName} (Xbox)`,
            source: 'Xbox Store',
            sourceIcon: 'fab fa-xbox',
            gameType: 'video'
        }];
    } catch (error) {
        console.error("Ошибка поиска в Xbox Store:", error);
        return [];
    }
}

async function searchPlayStationCovers(gameName) {
    try {
        return [{
            url: generatePlayStationStyleImage(gameName),
            thumbnail: generatePlayStationStyleImage(gameName, true),
            title: `${gameName} (PlayStation)`,
            source: 'PlayStation Store',
            sourceIcon: 'fab fa-playstation',
            gameType: 'video'
        }];
    } catch (error) {
        console.error("Ошибка поиска в PlayStation Store:", error);
        return [];
    }
}

async function searchNintendoCovers(gameName) {
    try {
        return [{
            url: generateNintendoStyleImage(gameName),
            thumbnail: generateNintendoStyleImage(gameName, true),
            title: `${gameName} (Nintendo)`,
            source: 'Nintendo eShop',
            sourceIcon: 'fas fa-gamepad',
            gameType: 'video'
        }];
    } catch (error) {
        console.error("Ошибка поиска в Nintendo eShop:", error);
        return [];
    }
}

async function searchRawgCovers(gameName) {
    try {
        const encodedName = encodeURIComponent(gameName);
        let rawgKey = API_CONFIG.RAWG_ALTERNATIVE;
        
        let url = `https://api.rawg.io/api/games?key=${rawgKey}&search=${encodedName}&page_size=5`;
        
        const response = await fetchWithRetry(url);
        
        if (!response.ok) {
            throw new Error(`RAWG API error: ${response.status}`);
        }
        
        const data = await response.json();
        const games = [];
        
        if (data.results && data.results.length > 0) {
            data.results.forEach(game => {
                if (game.background_image) {
                    games.push({
                        url: game.background_image,
                        thumbnail: game.background_image,
                        title: game.name,
                        source: 'RAWG.io',
                        sourceIcon: 'fas fa-database',
                        gameType: 'video',
                        metacritic: game.metacritic,
                        released: game.released
                    });
                }
            });
        }
        
        return games;
        
    } catch (error) {
        console.error("Ошибка поиска в RAWG:", error);
        return [];
    }
}

// Функции генерации стилей видеоигр (остаются без изменений)
function generateSteamStyleImage(gameName, isThumbnail = false) {
    const colors = [
        ['#1b2838', '#2a475e'],
        ['#171a21', '#66c0f4'],
        ['#2a475e', '#c7d5e0']
    ];
    
    const hash = gameName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const [color1, color2] = colors[hash % colors.length];
    
    const width = isThumbnail ? 231 : 460;
    const height = isThumbnail ? 87 : 215;
    
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
            <defs>
                <linearGradient id="steamGrad${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${color1}" />
                    <stop offset="100%" stop-color="${color2}" />
                </linearGradient>
                <filter id="steamShadow${hash}">
                    <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.3"/>
                </filter>
            </defs>
            <rect width="${width}" height="${height}" fill="url(#steamGrad${hash})"/>
            <text x="${width/2}" y="${height/2}" 
                  font-family="Arial, sans-serif" 
                  font-size="${isThumbnail ? 12 : 24}" 
                  font-weight="bold" 
                  fill="#c7d5e0" 
                  text-anchor="middle"
                  filter="url(#steamShadow${hash})">
                ${gameName.substring(0, isThumbnail ? 15 : 30)}
            </text>
            <text x="${width/2}" y="${height/2 + (isThumbnail ? 10 : 20)}" 
                  font-family="Arial, sans-serif" 
                  font-size="${isThumbnail ? 8 : 12}" 
                  fill="#66c0f4" 
                  text-anchor="middle">
                Steam
            </text>
        </svg>
    `;
    
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

function generateXboxStyleImage(gameName, isThumbnail = false) {
    const colors = [
        ['#107c10', '#0e700e'],
        ['#9bf00b', '#5ac100'],
        ['#5ac100', '#107c10']
    ];
    
    const hash = gameName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const [color1, color2] = colors[hash % colors.length];
    
    const width = isThumbnail ? 231 : 460;
    const height = isThumbnail ? 87 : 215;
    
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
            <defs>
                <linearGradient id="xboxGrad${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${color1}" />
                    <stop offset="100%" stop-color="${color2}" />
                </linearGradient>
                <filter id="xboxShadow${hash}">
                    <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.3"/>
                </filter>
            </defs>
            <rect width="${width}" height="${height}" fill="url(#xboxGrad${hash})"/>
            <text x="${width/2}" y="${height/2}" 
                  font-family="Arial, sans-serif" 
                  font-size="${isThumbnail ? 12 : 24}" 
                  font-weight="bold" 
                  fill="white" 
                  text-anchor="middle"
                  filter="url(#xboxShadow${hash})">
                ${gameName.substring(0, isThumbnail ? 15 : 30)}
            </text>
            <text x="${width/2}" y="${height/2 + (isThumbnail ? 10 : 20)}" 
                  font-family="Arial, sans-serif" 
                  font-size="${isThumbnail ? 8 : 12}" 
                  fill="#9bf00b" 
                  text-anchor="middle">
                Xbox
            </text>
        </svg>
    `;
    
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

function generatePlayStationStyleImage(gameName, isThumbnail = false) {
    const colors = [
        ['#0066cc', '#003399'],
        ['#003399', '#0066cc'],
        ['#0066cc', '#0099ff']
    ];
    
    const hash = gameName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const [color1, color2] = colors[hash % colors.length];
    
    const width = isThumbnail ? 231 : 460;
    const height = isThumbnail ? 87 : 215;
    
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
            <defs>
                <linearGradient id="psGrad${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${color1}" />
                    <stop offset="100%" stop-color="${color2}" />
                </linearGradient>
                <filter id="psShadow${hash}">
                    <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.3"/>
                </filter>
            </defs>
            <rect width="${width}" height="${height}" fill="url(#psGrad${hash})"/>
            <text x="${width/2}" y="${height/2}" 
                  font-family="Arial, sans-serif" 
                  font-size="${isThumbnail ? 12 : 24}" 
                  font-weight="bold" 
                  fill="white" 
                  text-anchor="middle"
                  filter="url(#psShadow${hash})">
                ${gameName.substring(0, isThumbnail ? 15 : 30)}
            </text>
            <text x="${width/2}" y="${height/2 + (isThumbnail ? 10 : 20)}" 
                  font-family="Arial, sans-serif" 
                  font-size="${isThumbnail ? 8 : 12}" 
                  fill="white" 
                  text-anchor="middle">
                PlayStation
            </text>
        </svg>
    `;
    
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

function generateNintendoStyleImage(gameName, isThumbnail = false) {
    const colors = [
        ['#e60012', '#b3000e'],
        ['#ff0000', '#cc0000'],
        ['#b3000e', '#8c000b']
    ];
    
    const hash = gameName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const [color1, color2] = colors[hash % colors.length];
    
    const width = isThumbnail ? 231 : 460;
    const height = isThumbnail ? 87 : 215;
    
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
            <defs>
                <linearGradient id="nintendoGrad${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${color1}" />
                    <stop offset="100%" stop-color="${color2}" />
                </linearGradient>
                <filter id="nintendoShadow${hash}">
                    <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.3"/>
                </filter>
            </defs>
            <rect width="${width}" height="${height}" fill="url(#nintendoGrad${hash})"/>
            <text x="${width/2}" y="${height/2}" 
                  font-family="Arial, sans-serif" 
                  font-size="${isThumbnail ? 12 : 24}" 
                  font-weight="bold" 
                  fill="white" 
                  text-anchor="middle"
                  filter="url(#nintendoShadow${hash})">
                ${gameName.substring(0, isThumbnail ? 15 : 30)}
            </text>
            <text x="${width/2}" y="${height/2 + (isThumbnail ? 10 : 20)}" 
                  font-family="Arial, sans-serif" 
                  font-size="${isThumbnail ? 8 : 12}" 
                  fill="white" 
                  text-anchor="middle">
                Nintendo
            </text>
        </svg>
    `;
    
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

function displaySearchResults(results) {
    const searchContainer = document.getElementById('search-results');
    if (!searchContainer) return;
    
    if (!results || results.length === 0) {
        searchContainer.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <i class="fas fa-search"></i>
                <p>Обложки не найдены</p>
                <p style="font-size: 0.75rem; margin-top: 0.5rem;">Попробуйте другой запрос</p>
            </div>
        `;
        return;
    }
    
    searchContainer.innerHTML = results.map((result, index) => `
        <div class="search-result-card ${selectedSearchResult === result ? 'selected' : ''}" 
             data-index="${index}"
             title="${result.title} (${result.source})">
            <img src="${result.thumbnail || result.url}" 
                 alt="${result.title}"
                 class="search-result-image"
                 onerror="this.onerror=null; this.src='${selectedGameType === 'board' ? generateBoardGameImage(result.title) : generateVideoGameImage(result.title)}';">
            <div class="search-result-info">
                <div class="search-result-title">
                    ${result.title.substring(0, 20)}${result.title.length > 20 ? '...' : ''}
                </div>
                <div class="search-result-source">
                    <i class="${result.sourceIcon || 'fas fa-image'}"></i>
                    ${result.source}
                    ${result.rating ? `<span style="color: gold; margin-left: 5px;">★ ${result.rating}</span>` : ''}
                </div>
                ${result.year ? `<div class="search-result-year">${result.year}</div>` : ''}
            </div>
        </div>
    `).join('');
    
    searchContainer.querySelectorAll('.search-result-card').forEach(card => {
        card.addEventListener('click', function() {
            const index = parseInt(this.dataset.index);
            selectSearchResult(index);
        });
    });
}

function selectSearchResult(index) {
    const result = currentSearchResults[index];
    if (!result) return;
    
    currentImageUrl = result.url;
    currentImageSource = result.source;
    selectedSearchResult = result;
    
    const preview = document.getElementById('image-preview');
    const sourceInfo = document.getElementById('image-source-info');
    const sourceSpan = document.getElementById('image-source');
    
    if (preview) {
        preview.src = result.url;
        preview.style.display = 'block';
        preview.onerror = function() {
            this.src = selectedGameType === 'board' 
                ? generateBoardGameImage(result.title)
                : generateVideoGameImage(result.title);
        };
    }
    
    if (sourceInfo && sourceSpan) {
        let sourceText = `${result.source} - ${result.title}`;
        if (result.year) sourceText += ` (${result.year})`;
        if (result.rating) sourceText += ` ★ ${result.rating}`;
        sourceSpan.textContent = sourceText;
        sourceInfo.style.display = 'block';
    }
    
    const urlInput = document.getElementById('game-image-url');
    if (urlInput && result.url) {
        urlInput.value = result.url;
    }
    
    document.querySelectorAll('.search-result-card').forEach((card, i) => {
        card.classList.toggle('selected', i === index);
    });
}

// ====================
// ЗАГРУЗКА IMGBB
// ====================
async function uploadImageToImgBB(file) {
    if (!imgbbApiKey || imgbbApiKey === API_CONFIG.IMGBB) {
        return await uploadWithDemoKey(file);
    }
    
    try {
        const formData = new FormData();
        formData.append('image', file);
        
        const response = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbApiKey}`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            return data.data.url;
        } else {
            console.error("ImgBB ошибка:", data.error);
            return await uploadWithDemoKey(file);
        }
        
    } catch (error) {
        console.error("Ошибка загрузки на ImgBB:", error);
        return await uploadWithDemoKey(file);
    }
}

async function uploadWithDemoKey(file) {
    if (file.size < 1024 * 1024) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                resolve(e.target.result);
            };
            reader.readAsDataURL(file);
        });
    }
    
    const gameName = document.getElementById('game-name')?.value || 'Игра';
    return selectedGameType === 'board' 
        ? generateBoardGameImage(gameName)
        : generateVideoGameImage(gameName);
}

// ====================
// ПОЛЬЗОВАТЕЛЬ И ИГРЫ
// ====================
async function loginUser(email, password) {
    try {
        await signInWithEmailAndPassword(auth, email, password);
        showNotification("Вход выполнен", "success");
    } catch (error) {
        let errorMessage = "Ошибка входа";
        switch (error.code) {
            case 'auth/user-not-found':
                errorMessage = "Пользователь не найден";
                break;
            case 'auth/wrong-password':
                errorMessage = "Неверный пароль";
                break;
            case 'auth/invalid-email':
                errorMessage = "Неверный email";
                break;
        }
        showNotification(errorMessage, "error");
    }
}

async function registerUser(email, password) {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, {
            displayName: email.split('@')[0]
        });
        showNotification("Регистрация успешна", "success");
    } catch (error) {
        let errorMessage = "Ошибка регистрации";
        switch (error.code) {
            case 'auth/email-already-in-use':
                errorMessage = "Email уже используется";
                break;
            case 'auth/weak-password':
                errorMessage = "Пароль должен быть не менее 6 символов";
                break;
            case 'auth/invalid-email':
                errorMessage = "Неверный email";
                break;
        }
        showNotification(errorMessage, "error");
    }
}

async function loadGames(filter = 'all') {
    if (!currentUser) return;
    
    const gamesGrid = document.getElementById('games-grid');
    if (!gamesGrid) return;
    
    gamesGrid.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Загрузка игр...</p></div>';
    
    try {
        let gamesQuery;
        
        if (filter === 'all') {
            gamesQuery = query(
                collection(db, 'users', currentUser.uid, 'games'),
                orderBy('addedAt', 'desc')
            );
        } else {
            gamesQuery = query(
                collection(db, 'users', currentUser.uid, 'games'),
                where('status', '==', filter),
                orderBy('addedAt', 'desc')
            );
        }
        
        const querySnapshot = await getDocs(gamesQuery);
        gamesGrid.innerHTML = '';
        
        if (querySnapshot.empty) {
            gamesGrid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-gamepad"></i>
                    <p>Нет игр в этой категории</p>
                    <button class="btn btn-primary" onclick="window.openAddGameModal()" style="margin-top: 1rem;">
                        Добавить первую игру
                    </button>
                </div>
            `;
            updateStats([]);
            return;
        }
        
        const games = [];
        querySnapshot.forEach((doc) => {
            games.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        games.sort((a, b) => {
            const dateA = a.addedAt?.toDate?.() || new Date(0);
            const dateB = b.addedAt?.toDate?.() || new Date(0);
            return dateB - dateA;
        });
        
        games.forEach((game) => {
            const gameCard = createGameCard(game.id, game);
            gamesGrid.appendChild(gameCard);
        });
        
        updateStats(games);
        
    } catch (error) {
        console.error("Ошибка загрузки игр:", error);
        gamesGrid.innerHTML = '<div class="empty-state"><p>Ошибка загрузки игр</p></div>';
        showNotification("Ошибка загрузки игр", "error");
    }
}

function createGameCard(gameId, game) {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.dataset.id = gameId;
    
    const imageUrl = game.image || (game.gameType === 'board' 
        ? generateBoardGameImage(game.name)
        : generateVideoGameImage(game.name));
    
    const sourceIcon = game.imageSource ? getSourceIcon(game.imageSource) : '';
    const sourceTitle = game.imageSource ? `Источник: ${game.imageSource}` : '';
    
    // Иконка типа игры
    const typeIcon = game.gameType === 'board' ? '<i class="fas fa-chess-board" title="Настольная игра"></i>' 
        : '<i class="fas fa-gamepad" title="Видеоигра"></i>';
    
    card.innerHTML = `
        <img src="${imageUrl}" alt="${game.name}" class="game-image" 
             onerror="this.onerror=null; this.src='${game.gameType === 'board' ? generateBoardGameImage(game.name) : generateVideoGameImage(game.name)}';">
        <div style="position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.7); color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem;">
            ${typeIcon}
        </div>
        ${sourceIcon ? `<div class="image-source-badge" title="${sourceTitle}">${sourceIcon}</div>` : ''}
        <div class="game-info">
            <h4 class="game-title">${game.name}</h4>
            <div class="game-meta">
                <span class="game-status status-${game.status}">
                    ${getStatusText(game.status)}
                </span>
                <div class="game-platforms">
                    ${(game.platforms || []).slice(0, 3).map(p => 
                        `<i class="${getPlatformIcon(p)} platform-icon" title="${getPlatformName(p)}"></i>`
                    ).join('')}
                </div>
            </div>
        </div>
    `;
    
    card.addEventListener('click', () => openGameDetails(gameId, game));
    return card;
}

function getSourceIcon(source) {
    const icons = {
        'Steam': '<i class="fab fa-steam"></i>',
        'Xbox Store': '<i class="fab fa-xbox"></i>',
        'PlayStation Store': '<i class="fab fa-playstation"></i>',
        'Nintendo eShop': '<i class="fas fa-gamepad"></i>',
        'RAWG.io': '<i class="fas fa-database"></i>',
        'BoardGameGeek': '<i class="fas fa-chess"></i>',
        'Board Game Generator': '<i class="fas fa-chess-board"></i>',
        'Board Game': '<i class="fas fa-dice"></i>',
        'Загружено с компьютера': '<i class="fas fa-upload"></i>',
        'Введено вручную': '<i class="fas fa-link"></i>',
        'generated': '<i class="fas fa-magic"></i>',
        'GameTracker': '<i class="fas fa-gamepad"></i>'
    };
    
    return icons[source] || '<i class="fas fa-image"></i>';
}

async function addGame(gameData) {
    if (!currentUser) return;
    
    try {
        let imageUrl = currentImageUrl || gameData.image || '';
        let imageSource = currentImageSource || 'generated';
        
        if (currentUploadFile) {
            showNotification("Загрузка изображения...", "info");
            imageUrl = await uploadImageToImgBB(currentUploadFile);
            imageSource = 'Загружено с компьютера';
        }
        
        if (!imageUrl) {
            imageUrl = selectedGameType === 'board'
                ? generateBoardGameImage(gameData.name)
                : generateVideoGameImage(gameData.name);
            imageSource = 'generated';
        }
        
        const gameToSave = {
            name: gameData.name,
            status: gameData.status,
            gameType: selectedGameType, // Сохраняем тип игры
            platforms: selectedGameType === 'video' ? gameData.platforms || [] : [], // Платформы только для видеоигр
            image: imageUrl,
            imageSource: imageSource,
            addedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };
        
        await addDoc(collection(db, 'users', currentUser.uid, 'games'), gameToSave);
        
        showNotification("Игра добавлена", "success");
        closeModal('add-game-modal');
        resetGameForm();
        loadGames('all');
        
    } catch (error) {
        console.error("Ошибка добавления игры:", error);
        showNotification("Ошибка добавления игры", "error");
    }
}

// ====================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ====================
function showNotification(message, type = 'info') {
    const oldNotifications = document.querySelectorAll('.notification');
    oldNotifications.forEach(n => {
        n.style.opacity = '0';
        setTimeout(() => n.remove(), 300);
    });
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <p>${message}</p>
        <button class="modal-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }
    }, 4000);
}

function updateStats(games = []) {
    const total = games.length;
    const playing = games.filter(g => g.status === 'playing').length;
    const completed = games.filter(g => g.status === 'completed').length;
    const planned = games.filter(g => g.status === 'planned').length;
    
    const videoGames = games.filter(g => g.gameType === 'video').length;
    const boardGames = games.filter(g => g.gameType === 'board').length;
    
    const totalEl = document.getElementById('total-games');
    const playingEl = document.getElementById('playing-games');
    const completedEl = document.getElementById('completed-games');
    const plannedEl = document.getElementById('planned-games');
    
    if (totalEl) totalEl.textContent = total;
    if (playingEl) playingEl.textContent = playing;
    if (completedEl) completedEl.textContent = completed;
    if (plannedEl) plannedEl.textContent = planned;
    
    // Можно добавить отображение статистики по типам игр
    console.log(`Видеоигры: ${videoGames}, Настольные: ${boardGames}`);
}

function getStatusText(status) {
    const statuses = {
        playing: '🎮 Играю',
        planned: '⏰ В планах',
        completed: '✅ Пройдено',
        dropped: '❌ Брошено'
    };
    return statuses[status] || status;
}

function getPlatformIcon(platform) {
    const icons = {
        pc: 'fas fa-desktop',
        ps5: 'fab fa-playstation',
        xbox: 'fab fa-xbox',
        switch: 'fas fa-gamepad',
        ps4: 'fab fa-playstation',
        mobile: 'fas fa-mobile-alt',
        vr: 'fas fa-vr-cardboard',
        mac: 'fab fa-apple',
        board: 'fas fa-chess-board', // Для настольных игр
        tabletop: 'fas fa-dice'      // Альтернативная иконка
    };
    return icons[platform] || 'fas fa-question';
}

function getPlatformName(platform) {
    const names = {
        pc: 'PC',
        ps5: 'PlayStation 5',
        xbox: 'Xbox',
        switch: 'Nintendo Switch',
        ps4: 'PlayStation 4',
        mobile: 'Mobile',
        vr: 'VR',
        mac: 'Mac',
        board: 'Настольная',
        tabletop: 'Настольная игра'
    };
    return names[platform] || platform;
}

function togglePlatform(platform) {
    const index = selectedPlatforms.indexOf(platform);
    if (index > -1) {
        selectedPlatforms.splice(index, 1);
    } else {
        selectedPlatforms.push(platform);
    }
}

function formatDate(timestamp) {
    if (!timestamp) return 'Неизвестно';
    try {
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return 'Неизвестно';
    }
}

function resetGameForm() {
    currentImageUrl = '';
    currentImageSource = '';
    selectedSearchResult = null;
    currentSearchResults = [];
    currentUploadFile = null;
    selectedPlatforms = [];
    selectedGameType = 'video'; // Сбрасываем к видеоиграм по умолчанию
    
    const nameInput = document.getElementById('game-name');
    const urlInput = document.getElementById('game-image-url');
    const preview = document.getElementById('image-preview');
    const sourceInfo = document.getElementById('image-source-info');
    const searchResults = document.getElementById('search-results');
    const fileInput = document.getElementById('game-image-upload');
    const gameTypeSelect = document.getElementById('game-type');
    
    if (nameInput) nameInput.value = '';
    if (urlInput) urlInput.value = '';
    if (preview) {
        preview.src = '';
        preview.style.display = 'none';
    }
    if (sourceInfo) sourceInfo.style.display = 'none';
    if (searchResults) searchResults.innerHTML = '';
    if (fileInput) fileInput.value = '';
    if (gameTypeSelect) gameTypeSelect.value = 'video';
    
    // Сбрасываем тип игры в интерфейсе
    document.querySelectorAll('.game-type-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.type === 'video') {
            btn.classList.add('active');
        }
    });
    
    // Сбрасываем платформы
    document.querySelectorAll('.platform-tag').forEach(tag => {
        tag.classList.remove('active');
    });
    
    document.querySelectorAll('.source-tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.dataset.source === 'url') {
            tab.classList.add('active');
        }
    });
    
    const searchContainer = document.getElementById('image-search-container');
    const urlContainer = document.getElementById('url-source-container');
    
    if (searchContainer) searchContainer.style.display = 'none';
    if (urlContainer) urlContainer.style.display = 'block';
    
    const statusSelect = document.getElementById('game-status');
    if (statusSelect) statusSelect.value = 'playing';
    
    // Обновляем видимость секции платформ
    updatePlatformsVisibility();
}

// ====================
// УПРАВЛЕНИЕ ТИПОМ ИГРЫ
// ====================
function changeGameType(type) {
    selectedGameType = type;
    
    // Обновляем активные кнопки
    document.querySelectorAll('.game-type-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.type === type) {
            btn.classList.add('active');
        }
    });
    
    // Обновляем видимость секции платформ
    updatePlatformsVisibility();
    
    // Обновляем доступные источники поиска
    updateSearchSources();
    
    // Сбрасываем результаты поиска
    const searchResults = document.getElementById('search-results');
    if (searchResults) {
        searchResults.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1; padding: 2rem;">
                <i class="fas fa-gamepad"></i>
                <p style="font-size: 0.875rem;">Выберите тип игры и введите название для поиска</p>
            </div>
        `;
    }
    
    showNotification(`Тип игры: ${type === 'video' ? 'Видеоигра' : 'Настольная игра'}`, 'info');
}

function updatePlatformsVisibility() {
    const platformsSection = document.querySelector('.form-group:nth-child(3)'); // Секция платформ
    if (platformsSection) {
        platformsSection.style.display = selectedGameType === 'video' ? 'block' : 'none';
    }
}

function updateSearchSources() {
    const sourcesContainer = document.querySelector('.search-sources');
    if (!sourcesContainer) return;
    
    if (selectedGameType === 'video') {
        // Источники для видеоигр
        sourcesContainer.innerHTML = `
            <span class="platform-tag active" data-source="all">
                <i class="fas fa-globe"></i> Все
            </span>
            <span class="platform-tag" data-source="steam">
                <i class="fab fa-steam"></i> Steam
            </span>
            <span class="platform-tag" data-source="xbox">
                <i class="fab fa-xbox"></i> Xbox
            </span>
            <span class="platform-tag" data-source="playstation">
                <i class="fab fa-playstation"></i> PlayStation
            </span>
            <span class="platform-tag" data-source="nintendo">
                <i class="fas fa-gamepad"></i> Nintendo
            </span>
        `;
    } else {
        // Источники для настольных игр
        sourcesContainer.innerHTML = `
            <span class="platform-tag active" data-source="all">
                <i class="fas fa-globe"></i> Все
            </span>
            <span class="platform-tag" data-source="boardgamegeek">
                <i class="fas fa-chess"></i> BoardGameGeek
            </span>
        `;
    }
    
    // Добавляем обработчики для новых кнопок
    sourcesContainer.querySelectorAll('.platform-tag').forEach(tag => {
        tag.addEventListener('click', function() {
            if (this.dataset.source) {
                document.querySelectorAll('.platform-tag').forEach(t => {
                    t.classList.remove('active');
                });
                this.classList.add('active');
                
                const query = document.getElementById('game-search-input')?.value.trim();
                if (query) {
                    searchGameCovers(query, this.dataset.source);
                }
            }
        });
    });
}

// ====================
// УПРАВЛЕНИЕ ИНТЕРФЕЙСОМ
// ====================
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

function openAddGameModal() {
    resetGameForm();
    openModal('add-game-modal');
}

function openGameDetails(gameId, game) {
    const existingModal = document.getElementById('game-details-modal');
    if (existingModal) existingModal.remove();
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'game-details-modal';
    
    const imageUrl = game.image || (game.gameType === 'board' 
        ? generateBoardGameImage(game.name)
        : generateVideoGameImage(game.name));
        
    const platformsText = (game.platforms || []).map(p => getPlatformName(p)).join(', ') || 'Не указаны';
    const dateText = game.addedAt ? formatDate(game.addedAt) : 'Неизвестно';
    const gameTypeText = game.gameType === 'board' ? 'Настольная игра' : 'Видеоигра';
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <div class="modal-header">
                <h3>${game.name}</h3>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <div style="display: flex; gap: 1.5rem; margin-bottom: 1.5rem; flex-wrap: wrap;">
                    <img src="${imageUrl}" alt="${game.name}" 
                         style="width: 200px; height: 300px; object-fit: cover; border-radius: 8px;"
                         onerror="this.src='${game.gameType === 'board' ? generateBoardGameImage(game.name) : generateVideoGameImage(game.name)}'">
                    <div style="flex: 1; min-width: 200px;">
                        <h4 style="margin-bottom: 1rem;">Информация</h4>
                        <p><strong>Тип:</strong> ${gameTypeText}</p>
                        <p><strong>Статус:</strong> ${getStatusText(game.status)}</p>
                        ${game.gameType === 'video' ? `<p><strong>Платформы:</strong> ${platformsText}</p>` : ''}
                        <p><strong>Добавлено:</strong> ${dateText}</p>
                        ${game.imageSource ? `<p><strong>Источник обложки:</strong> ${game.imageSource}</p>` : ''}
                    </div>
                </div>
                
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    <button class="btn btn-primary" onclick="window.editGame('${gameId}')">
                        <i class="fas fa-edit"></i> Редактировать
                    </button>
                    <button class="btn btn-danger" onclick="window.deleteGame('${gameId}')">
                        <i class="fas fa-trash"></i> Удалить
                    </button>
                    <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">
                        Закрыть
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    
    modal.querySelector('.modal-close').addEventListener('click', () => {
        modal.remove();
        document.body.style.overflow = 'auto';
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
            document.body.style.overflow = 'auto';
        }
    });
}

function editGame(gameId) {
    const detailsModal = document.getElementById('game-details-modal');
    if (detailsModal) detailsModal.remove();
    showNotification("Редактирование в разработке", "info");
}

async function deleteGame(gameId) {
    if (!currentUser) return;
    
    if (!confirm("Удалить игру?")) return;
    
    try {
        await deleteDoc(doc(db, 'users', currentUser.uid, 'games', gameId));
        showNotification("Игра удалена", "success");
        loadGames('all');
        
        const modal = document.getElementById('game-details-modal');
        if (modal) modal.remove();
        
    } catch (error) {
        console.error("Ошибка удаления игры:", error);
        showNotification("Ошибка удаления игры", "error");
    }
}

// ====================
// ОБРАБОТЧИКИ ФАЙЛОВ
// ====================
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        showNotification("Пожалуйста, выберите изображение", "error");
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        showNotification("Изображение должно быть меньше 5MB", "error");
        return;
    }
    
    currentUploadFile = file;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const preview = document.getElementById('image-preview');
        const sourceInfo = document.getElementById('image-source-info');
        const sourceSpan = document.getElementById('image-source');
        
        if (preview) {
            currentImageUrl = e.target.result;
            currentImageSource = 'Загружено с компьютера';
            preview.src = e.target.result;
            preview.style.display = 'block';
        }
        
        if (sourceInfo && sourceSpan) {
            sourceSpan.textContent = 'Загружено с компьютера';
            sourceInfo.style.display = 'block';
        }
        
        const urlInput = document.getElementById('game-image-url');
        if (urlInput) {
            urlInput.value = e.target.result;
        }
        
        selectedSearchResult = null;
        currentSearchResults = [];
        const searchResults = document.getElementById('search-results');
        if (searchResults) searchResults.innerHTML = '';
    };
    reader.readAsDataURL(file);
}

function handleImageUrl() {
    const urlInput = document.getElementById('game-image-url');
    const preview = document.getElementById('image-preview');
    const sourceInfo = document.getElementById('image-source-info');
    const sourceSpan = document.getElementById('image-source');
    
    if (!urlInput || !preview) return;
    
    const url = urlInput.value.trim();
    if (url) {
        currentImageUrl = url;
        currentImageSource = 'Введено вручную';
        
        preview.src = url;
        preview.style.display = 'block';
        
        preview.onerror = function() {
            const gameName = document.getElementById('game-name')?.value || 'Игра';
            this.src = selectedGameType === 'board'
                ? generateBoardGameImage(gameName)
                : generateVideoGameImage(gameName);
        };
        
        if (sourceInfo && sourceSpan) {
            sourceSpan.textContent = 'Введено вручную';
            sourceInfo.style.display = 'block';
        }
        
        selectedSearchResult = null;
        currentSearchResults = [];
        currentUploadFile = null;
        const searchResults = document.getElementById('search-results');
        if (searchResults) searchResults.innerHTML = '';
        const fileInput = document.getElementById('game-image-upload');
        if (fileInput) fileInput.value = '';
    }
}

// ====================
// НАВИГАЦИЯ
// ====================
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            document.querySelectorAll('.nav-item').forEach(navItem => {
                navItem.classList.remove('active');
            });
            
            item.classList.add('active');
            
            document.querySelectorAll('.content-section').forEach(section => {
                section.classList.remove('active');
            });
            
            const sectionId = item.dataset.section + '-section';
            const targetSection = document.getElementById(sectionId);
            
            if (targetSection) {
                targetSection.classList.add('active');
                
                switch(item.dataset.section) {
                    case 'games':
                        loadGames('all');
                        break;
                    case 'wishlist':
                        loadGames('planned');
                        break;
                    case 'completed':
                        loadGames('completed');
                        break;
                    case 'settings':
                        updateImgBBKeyField();
                        break;
                }
                
                if (window.innerWidth < 1024) {
                    const sidebar = document.getElementById('app-sidebar');
                    if (sidebar) sidebar.classList.remove('active');
                }
            }
        });
    });
    
    document.querySelectorAll('.tab-btn').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(t => {
                t.classList.remove('active');
            });
            tab.classList.add('active');
            loadGames(tab.dataset.filter);
        });
    });
}

function setupImageSourceTabs() {
    document.querySelectorAll('.source-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const source = this.dataset.source;
            
            document.querySelectorAll('.source-tab').forEach(t => {
                t.classList.remove('active');
            });
            this.classList.add('active');
            
            const searchContainer = document.getElementById('image-search-container');
            const urlContainer = document.getElementById('url-source-container');
            const uploadContainer = document.getElementById('upload-source-container');
            
            if (urlContainer) {
                urlContainer.style.display = source === 'url' ? 'block' : 'none';
            }
            
            if (searchContainer) {
                searchContainer.style.display = source === 'search' ? 'block' : 'none';
            }
            
            if (uploadContainer) {
                uploadContainer.style.display = source === 'upload' ? 'block' : 'none';
            }
            
            if (source !== 'search') {
                const searchResults = document.getElementById('search-results');
                if (searchResults) searchResults.innerHTML = '';
                currentSearchResults = [];
                selectedSearchResult = null;
            }
            
            if (source === 'upload') {
                const urlInput = document.getElementById('game-image-url');
                if (urlInput) urlInput.value = '';
                currentImageUrl = '';
                currentImageSource = '';
            }
        });
    });
}

// ====================
// ИНИЦИАЛИЗАЦИЯ
// ====================
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        const authSection = document.getElementById('auth-section');
        const mainContent = document.getElementById('main-content');
        
        if (authSection) authSection.style.display = 'none';
        if (mainContent) mainContent.style.display = 'block';
        
        const userName = user.displayName || user.email.split('@')[0];
        document.getElementById('user-name').textContent = userName;
        document.getElementById('user-email').textContent = user.email;
        const avatarText = userName[0].toUpperCase();
        document.getElementById('user-avatar').textContent = avatarText;
        document.getElementById('user-avatar-large').textContent = avatarText;
        
        initTheme();
        
        const savedKey = localStorage.getItem('imgbb_api_key');
        if (savedKey) {
            imgbbApiKey = savedKey;
        }
        
        loadGames('all');
        
    } else {
        currentUser = null;
        const authSection = document.getElementById('auth-section');
        const mainContent = document.getElementById('main-content');
        
        if (authSection) authSection.style.display = 'flex';
        if (mainContent) mainContent.style.display = 'none';
    }
});

// ====================
// ГЛОБАЛЬНЫЕ ФУНКЦИИ
// ====================
window.openAddGameModal = openAddGameModal;
window.deleteGame = deleteGame;
window.editGame = editGame;
window.closeModal = closeModal;
window.changeTheme = changeTheme;
window.changeGameType = changeGameType;

// ====================
// ОБРАБОТЧИКИ СОБЫТИЙ
// ====================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    
    // Тип игры
    document.querySelectorAll('.game-type-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const type = this.dataset.type;
            if (type) {
                changeGameType(type);
            }
        });
    });
    
    const loginBtn = document.getElementById('login-btn');
    const registerBtn = document.getElementById('register-btn');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            const email = emailInput?.value;
            const password = passwordInput?.value;
            if (email && password) {
                loginUser(email, password);
            } else {
                showNotification("Введите email и пароль", "error");
            }
        });
    }
    
    if (registerBtn) {
        registerBtn.addEventListener('click', () => {
            const email = emailInput?.value;
            const password = passwordInput?.value;
            if (email && password) {
                if (password.length < 6) {
                    showNotification("Пароль должен быть не менее 6 символов", "error");
                    return;
                }
                registerUser(email, password);
            } else {
                showNotification("Введите email и пароль", "error");
            }
        });
    }
    
    if (passwordInput) {
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                if (loginBtn) loginBtn.click();
            }
        });
    }
    
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            const sidebar = document.getElementById('app-sidebar');
            if (sidebar) sidebar.classList.toggle('active');
        });
    }
    
    setupNavigation();
    
    const addGameBtn = document.getElementById('add-game-btn');
    if (addGameBtn) {
        addGameBtn.addEventListener('click', openAddGameModal);
    }
    
    const saveGameBtn = document.getElementById('save-game-btn');
    if (saveGameBtn) {
        saveGameBtn.addEventListener('click', () => {
            const nameInput = document.getElementById('game-name');
            const statusSelect = document.getElementById('game-status');
            const urlInput = document.getElementById('game-image-url');
            
            if (!nameInput || !statusSelect) return;
            
            const name = nameInput.value.trim();
            const status = statusSelect.value;
            const imageUrl = urlInput ? urlInput.value.trim() : '';
            
            if (!name) {
                showNotification("Введите название игры", "error");
                return;
            }
            
            const gameData = {
                name,
                status,
                platforms: selectedPlatforms,
                image: imageUrl
            };
            
            addGame(gameData);
        });
    }
    
    setupImageSourceTabs();
    
    const searchGameBtn = document.getElementById('search-game-btn');
    const gameSearchInput = document.getElementById('game-search-input');
    
    if (searchGameBtn && gameSearchInput) {
        searchGameBtn.addEventListener('click', () => {
            const query = gameSearchInput.value.trim();
            if (query) {
                const selectedSource = document.querySelector('[data-source].platform-tag.active');
                const source = selectedSource ? selectedSource.dataset.source : 'all';
                searchGameCovers(query, source);
            } else {
                showNotification("Введите название игры для поиска", "error");
            }
        });
        
        gameSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchGameBtn.click();
            }
        });
    }
    
    // Инициализируем источники поиска
    updateSearchSources();
    
    document.querySelectorAll('[data-source].platform-tag').forEach(tag => {
        tag.addEventListener('click', function() {
            if (this.dataset.source) {
                document.querySelectorAll('[data-source].platform-tag').forEach(t => {
                    t.classList.remove('active');
                });
                
                this.classList.add('active');
                
                const query = gameSearchInput?.value.trim();
                if (query) {
                    searchGameCovers(query, this.dataset.source);
                }
            }
        });
    });
    
    const imageUpload = document.getElementById('game-image-upload');
    if (imageUpload) {
        imageUpload.addEventListener('change', handleImageUpload);
    }
    
    const uploadImageBtn = document.getElementById('upload-image-btn');
    if (uploadImageBtn) {
        uploadImageBtn.addEventListener('click', () => {
            const fileInput = document.getElementById('game-image-upload');
            if (fileInput) fileInput.click();
        });
    }
    
    const imageUrlInput = document.getElementById('game-image-url');
    if (imageUrlInput) {
        imageUrlInput.addEventListener('input', handleImageUrl);
    }
    
    document.querySelectorAll('.platform-tag').forEach(tag => {
        if (tag.dataset.platform) {
            tag.addEventListener('click', () => {
                tag.classList.toggle('active');
                const platform = tag.dataset.platform;
                togglePlatform(platform);
            });
        }
    });
    
    const saveImgBBKeyBtn = document.getElementById('save-imgbb-key');
    if (saveImgBBKeyBtn) {
        saveImgBBKeyBtn.addEventListener('click', saveImgBBKey);
    }
    
    const imgbbKeyInput = document.getElementById('imgbb-api-key');
    if (imgbbKeyInput) {
        imgbbKeyInput.addEventListener('focus', function() {
            const savedKey = localStorage.getItem('imgbb_api_key');
            if (savedKey) {
                this.value = savedKey;
                this.type = 'text';
            }
        });
        
        imgbbKeyInput.addEventListener('blur', function() {
            const savedKey = localStorage.getItem('imgbb_api_key');
            if (savedKey && this.value === savedKey) {
                const maskedKey = savedKey.substring(0, 4) + '...' + savedKey.substring(savedKey.length - 4);
                this.value = maskedKey;
                this.type = 'password';
            }
        });
    }
    
    document.querySelectorAll('.theme-card').forEach(card => {
        card.addEventListener('click', function() {
            const themeName = this.dataset.theme;
            if (themeName) {
                changeTheme(themeName);
            }
        });
    });
    
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) {
                modal.style.display = 'none';
                document.body.style.overflow = 'auto';
            }
        });
    });
    
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    });
    
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            signOut(auth).then(() => {
                showNotification("Выход выполнен", "success");
            });
        });
    }
    
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            showNotification("Поиск по играм в разработке", "info");
        });
    }
    
    if (imgbbKeyInput) {
        imgbbKeyInput.addEventListener('focus', function() {
            const savedKey = localStorage.getItem('imgbb_api_key');
            if (savedKey) {
                this.value = savedKey;
            }
        });
    }
});

window.addEventListener('resize', () => {
    const sidebar = document.getElementById('app-sidebar');
    if (window.innerWidth >= 1024 && sidebar) {
        sidebar.classList.remove('active');
    }
});

document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('app-sidebar');
    const menuToggle = document.getElementById('menu-toggle');
    
    if (sidebar && sidebar.classList.contains('active') && 
        !sidebar.contains(e.target) && 
        menuToggle && !menuToggle.contains(e.target) &&
        window.innerWidth < 1024) {
        sidebar.classList.remove('active');
    }
});