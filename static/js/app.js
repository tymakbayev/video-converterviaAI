/**
 * Простой обработчик загрузки и конвертации видео
 */
document.addEventListener('DOMContentLoaded', function() {
    // Элементы интерфейса
    const uploadForm = document.getElementById('upload-form');
    const fileInput = document.getElementById('file-input');
    const fileName = document.getElementById('file-name');
    const uploadButton = document.getElementById('upload-button');
    
    const uploadContainer = document.getElementById('upload-container');
    const progressContainer = document.getElementById('progress-container');
    const processingContainer = document.getElementById('processing-container');
    const resultContainer = document.getElementById('result-container');
    const errorContainer = document.getElementById('error-container');
    
    const progressBar = document.getElementById('progress-bar');
    const progressPercentage = document.getElementById('progress-percentage');
    const statusText = document.getElementById('status-text');
    const resultMessage = document.getElementById('result-message');
    const videoInfo = document.getElementById('video-info');
    
    const downloadButton = document.getElementById('download-button');
    const convertAnotherButton = document.getElementById('convert-another-button');
    const tryAgainButton = document.getElementById('try-again-button');
    const errorMessage = document.getElementById('error-message');
    
    // Статистика
    let stats = {
        totalConversions: 0,
        successfulConversions: 0,
        failedConversions: 0
    };
    
    // Ограничение размера файла
    const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB
    
    // Текущее состояние
    let currentJobId = null;
    let pollingInterval = null;
    let conversionStartTime = 0;
    
    // Обработчик выбора файла
    fileInput.addEventListener('change', function() {
        if (this.files.length > 0) {
            const file = this.files[0];
            
            // Проверка размера файла
            if (file.size > MAX_FILE_SIZE) {
                showError(`Файл слишком большой. Максимальный размер: 1 ГБ`);
                this.value = '';
                fileName.textContent = 'Файл не выбран';
                uploadButton.disabled = true;
                return;
            }
            
            // Проверка типа файла
            if (!file.type.startsWith('video/') && !file.name.match(/\.(mp4|avi|mov|wmv|mkv|flv|webm|3gp)$/i)) {
                showError('Пожалуйста, выберите видеофайл');
                this.value = '';
                fileName.textContent = 'Файл не выбран';
                uploadButton.disabled = true;
                return;
            }
            
            // Отображаем имя файла и активируем кнопку
            fileName.textContent = file.name;
            uploadButton.disabled = false;
        } else {
            fileName.textContent = 'Файл не выбран';
            uploadButton.disabled = true;
        }
    });
    
    // Обработчик отправки формы
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        if (fileInput.files.length === 0) {
            showError('Пожалуйста, выберите файл для загрузки');
            return;
        }
        
        startUpload(fileInput.files[0]);
    });
    
    // Обработчик кнопки "Конвертировать еще"
    convertAnotherButton.addEventListener('click', resetForm);
    
    // Обработчик кнопки "Попробовать снова"
    tryAgainButton.addEventListener('click', resetForm);
    
    // Функция начала загрузки
    function startUpload(file) {
        // Показываем индикатор прогресса
        uploadContainer.classList.add('hidden');
        progressContainer.classList.remove('hidden');
        statusText.textContent = 'Загрузка файла...';
        
        // Создаем FormData для отправки файла
        const formData = new FormData();
        formData.append('file', file);
        
        // Отправляем запрос
        const xhr = new XMLHttpRequest();
        
        // Отслеживаем прогресс загрузки
        xhr.upload.addEventListener('progress', function(e) {
            if (e.lengthComputable) {
                const percentComplete = Math.round((e.loaded / e.total) * 100);
                progressBar.style.width = percentComplete + '%';
                progressPercentage.textContent = percentComplete + '%';
            }
        });
        
        // Обработка завершения загрузки
        xhr.addEventListener('load', function() {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const response = JSON.parse(xhr.responseText);
                    currentJobId = response.job_id;
                    
                    // Показываем индикатор обработки
                    progressContainer.classList.add('hidden');
                    processingContainer.classList.remove('hidden');
                    
                    // Запоминаем время начала конвертации
                    conversionStartTime = Date.now();
                    
                    // Начинаем опрос статуса
                    startPolling(currentJobId);
                } catch (error) {
                    showError('Ошибка сервера. Пожалуйста, попробуйте снова.');
                }
            } else {
                try {
                    const response = JSON.parse(xhr.responseText);
                    showError(response.error || 'Ошибка загрузки. Пожалуйста, попробуйте снова.');
                } catch (error) {
                    showError('Ошибка загрузки. Пожалуйста, попробуйте снова.');
                }
            }
        });
        
        // Обработка ошибок сети
        xhr.addEventListener('error', function() {
            showError('Ошибка сети. Проверьте соединение и попробуйте снова.');
        });
        
        // Обработка прерывания запроса
        xhr.addEventListener('abort', function() {
            showError('Загрузка прервана. Пожалуйста, попробуйте снова.');
        });
        
        // Отправляем запрос
        xhr.open('POST', '/upload', true);
        xhr.send(formData);
    }
    
    // Функция опроса статуса
    function startPolling(jobId) {
        if (pollingInterval) {
            clearInterval(pollingInterval);
        }
        
        pollingInterval = setInterval(function() {
            fetch(`/status/${jobId}`)
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Status check failed');
                    }
                    return response.json();
                })
                .then(data => {
                    // Обрабатываем статус
                    switch (data.status) {
                        case 'uploaded':
                        case 'processing':
                            // Продолжаем опрос
                            break;
                            
                        case 'completed':
                            // Останавливаем опрос
                            clearInterval(pollingInterval);
                            pollingInterval = null;
                            
                            // Обновляем статистику
                            stats.totalConversions++;
                            stats.successfulConversions++;
                            
                            // Вычисляем время обработки
                            const processingTime = (Date.now() - conversionStartTime) / 1000; // в секундах
                            
                            // Показываем результат
                            processingContainer.classList.add('hidden');
                            resultContainer.classList.remove('hidden');
                            
                            // Очищаем предыдущую информацию о видео
                            videoInfo.innerHTML = '';
                            
                            // Добавляем информацию о видео
                            if (data.video_info) {
                                const infoDiv = document.createElement('div');
                                infoDiv.innerHTML = `
                                    <h4>Информация о видео:</h4>
                                    <ul>
                                        <li>Разрешение: ${data.video_info.width}x${data.video_info.height}</li>
                                        <li>Длительность: ${Math.round(data.video_info.duration)} секунд</li>
                                        <li>${data.video_info.is_vertical ? 'Вертикальное видео' : 'Горизонтальное видео'}</li>
                                        <li>${data.video_info.has_audio ? 'Видео со звуком' : 'Видео без звука'}</li>
                                    </ul>
                                    <p class="processing-time">Время конвертации: ${processingTime.toFixed(1)} секунд</p>
                                `;
                                videoInfo.appendChild(infoDiv);
                            } else {
                                const timeInfo = document.createElement('p');
                                timeInfo.classList.add('processing-time');
                                timeInfo.textContent = `Время конвертации: ${processingTime.toFixed(1)} секунд`;
                                videoInfo.appendChild(timeInfo);
                            }
                            
                            // Настройка кнопки скачивания
                            downloadButton.onclick = function() {
                                window.location.href = data.download_url;
                            };
                            break;
                            
                        case 'error':
                            // Останавливаем опрос
                            clearInterval(pollingInterval);
                            pollingInterval = null;
                            
                            // Обновляем статистику
                            stats.totalConversions++;
                            stats.failedConversions++;
                            
                            // Показываем ошибку
                            showError(data.error || 'Ошибка конвертации. Пожалуйста, попробуйте с другим файлом.');
                            break;
                            
                        default:
                            // Неизвестный статус
                            clearInterval(pollingInterval);
                            pollingInterval = null;
                            showError('Неизвестный статус конвертации. Пожалуйста, попробуйте снова.');
                    }
                })
                .catch(error => {
                    clearInterval(pollingInterval);
                    pollingInterval = null;
                    showError('Ошибка при проверке статуса. Пожалуйста, попробуйте снова.');
                });
        }, 2000); // Проверять каждые 2 секунды
    }
    
    // Функция отображения ошибки
    function showError(message) {
        uploadContainer.classList.add('hidden');
        progressContainer.classList.add('hidden');
        processingContainer.classList.add('hidden');
        resultContainer.classList.add('hidden');
        
        errorContainer.classList.remove('hidden');
        errorMessage.textContent = message;
    }
    
    // Функция сброса формы
    function resetForm() {
        // Скрываем все контейнеры кроме формы загрузки
        resultContainer.classList.add('hidden');
        errorContainer.classList.add('hidden');
        progressContainer.classList.add('hidden');
        processingContainer.classList.add('hidden');
        
        uploadContainer.classList.remove('hidden');
        
        // Сбрасываем прогресс
        progressBar.style.width = '0%';
        progressPercentage.textContent = '0%';
        
        // Очищаем поле выбора файла
        fileInput.value = '';
        fileName.textContent = 'Файл не выбран';
        uploadButton.disabled = true;
        
        // Очищаем текущий идентификатор задачи и интервал
        currentJobId = null;
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
    }
    
    // Drag & drop функциональность
    const dropZone = document.querySelector('.container');
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefault, false);
    });
    
    function preventDefault(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.add('highlight');
        });
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.remove('highlight');
        });
    });
    
    dropZone.addEventListener('drop', function(e) {
        const droppedFiles = e.dataTransfer.files;
        
        if (droppedFiles.length > 0) {
            // В отличие от копирования через .files = ..., мы вручную устанавливаем файл
            fileInput.files = droppedFiles;
            
            // И вручную запускаем обработчик изменения
            const changeEvent = new Event('change', { bubbles: true });
            fileInput.dispatchEvent(changeEvent);
        }
    });
    
    // Добавляем кнопку статистики в футер
    const statsButton = document.createElement('button');
    statsButton.classList.add('stats-button');
    statsButton.textContent = 'Показать статистику';
    statsButton.addEventListener('click', function() {
        alert(`Статистика конвертаций:
- Всего конвертаций: ${stats.totalConversions}
- Успешных конвертаций: ${stats.successfulConversions}
- Неудачных конвертаций: ${stats.failedConversions}`);
    });
    
    document.querySelector('footer').appendChild(statsButton);
});