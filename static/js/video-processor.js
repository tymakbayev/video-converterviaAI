/**
 * VideoProcessor - Модуль для управления видео конвертацией
 * Обеспечивает функциональность загрузки, отслеживания прогресса и
 * взаимодействия с серверным API
 */
class VideoProcessor {
    constructor(config = {}) {
        // Настройки по умолчанию
        this.config = {
            uploadEndpoint: '/upload',
            statusEndpoint: '/status/',
            downloadEndpoint: '/download/',
            maxFileSize: 1024 * 1024 * 1024, // 1GB
            pollInterval: 2000, // 2 секунды
            ...config
        };
        
        // События
        this.events = {
            onUploadStart: () => {},
            onUploadProgress: (percentage) => {},
            onUploadComplete: () => {},
            onProcessingStart: () => {},
            onProcessingComplete: (downloadUrl) => {},
            onError: (message) => {},
            onReset: () => {}
        };
        
        // Состояние
        this.state = {
            currentFile: null,
            jobId: null,
            pollingInterval: null,
            downloadUrl: null
        };
    }
    
    /**
     * Привязывает обработчики событий
     * @param {Object} events - Объект с функциями-обработчиками событий
     */
    on(events) {
        this.events = { ...this.events, ...events };
        return this;
    }
    
    /**
     * Устанавливает файл для загрузки
     * @param {File} file - Файл для загрузки и обработки
     */
    setFile(file) {
        // Сбросить текущее состояние
        this.reset();
        
        // Проверка размера файла
        if (file.size > this.config.maxFileSize) {
            this.events.onError(`Файл слишком большой. Максимальный размер: ${Math.floor(this.config.maxFileSize / (1024 * 1024))} МБ`);
            return false;
        }
        
        // Проверка типа файла
        if (!file.type.startsWith('video/')) {
            this.events.onError('Пожалуйста, выберите видеофайл');
            return false;
        }
        
        this.state.currentFile = file;
        return true;
    }
    
    /**
     * Запускает процесс загрузки и обработки
     */
    start() {
        if (!this.state.currentFile) {
            this.events.onError('Пожалуйста, выберите файл для загрузки');
            return;
        }
        
        // Создаем FormData для отправки файла
        const formData = new FormData();
        formData.append('file', this.state.currentFile);
        
        // Оповещаем о начале загрузки
        this.events.onUploadStart();
        
        // Создаем и настраиваем запрос
        const xhr = new XMLHttpRequest();
        
        // Отслеживаем прогресс загрузки
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percentage = Math.round((e.loaded / e.total) * 100);
                this.events.onUploadProgress(percentage);
            }
        });
        
        // Обработка завершения запроса
        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const response = JSON.parse(xhr.responseText);
                    this.state.jobId = response.job_id;
                    
                    // Оповещаем о завершении загрузки
                    this.events.onUploadComplete();
                    
                    // Начинаем отслеживать статус обработки
                    this.events.onProcessingStart();
                    this.startStatusPolling();
                } catch (error) {
                    this.events.onError('Ошибка сервера. Пожалуйста, попробуйте снова.');
                }
            } else {
                try {
                    const response = JSON.parse(xhr.responseText);
                    this.events.onError(response.error || 'Ошибка загрузки. Пожалуйста, попробуйте снова.');
                } catch (error) {
                    this.events.onError('Ошибка загрузки. Пожалуйста, попробуйте снова.');
                }
            }
        });
        
        // Обработка ошибок сети
        xhr.addEventListener('error', () => {
            this.events.onError('Ошибка сети. Проверьте соединение и попробуйте снова.');
        });
        
        // Обработка прерывания запроса
        xhr.addEventListener('abort', () => {
            this.events.onError('Загрузка прервана. Пожалуйста, попробуйте снова.');
        });
        
        // Отправляем запрос
        xhr.open('POST', this.config.uploadEndpoint, true);
        xhr.send(formData);
    }
    
    /**
     * Начинает периодический опрос статуса обработки
     */
    startStatusPolling() {
        // Очищаем предыдущий интервал, если есть
        if (this.state.pollingInterval) {
            clearInterval(this.state.pollingInterval);
        }
        
        // Устанавливаем новый интервал
        this.state.pollingInterval = setInterval(() => {
            this.checkStatus();
        }, this.config.pollInterval);
    }
    
    /**
     * Отправляет запрос для проверки статуса обработки
     */
    checkStatus() {
        if (!this.state.jobId) return;
        
        fetch(`${this.config.statusEndpoint}${this.state.jobId}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error('Ошибка проверки статуса');
                }
                return response.json();
            })
            .then(data => {
                // Обрабатываем различные статусы
                switch (data.status) {
                    case 'uploaded':
                    case 'processing':
                        // Продолжаем опрос
                        break;
                        
                    case 'completed':
                        // Останавливаем опрос
                        this.stopStatusPolling();
                        
                        // Сохраняем URL для скачивания
                        this.state.downloadUrl = data.download_url;
                        
                        // Оповещаем о завершении обработки
                        this.events.onProcessingComplete(data.download_url);
                        break;
                        
                    case 'error':
                        // Останавливаем опрос
                        this.stopStatusPolling();
                        
                        // Оповещаем об ошибке
                        this.events.onError(data.error || 'Ошибка конвертации. Пожалуйста, попробуйте другой файл.');
                        break;
                        
                    default:
                        // Неизвестный статус
                        this.stopStatusPolling();
                        this.events.onError('Неизвестный статус. Пожалуйста, попробуйте снова.');
                }
            })
            .catch(error => {
                this.stopStatusPolling();
                this.events.onError('Ошибка проверки статуса. Пожалуйста, попробуйте снова.');
            });
    }
    
    /**
     * Останавливает опрос статуса
     */
    stopStatusPolling() {
        if (this.state.pollingInterval) {
            clearInterval(this.state.pollingInterval);
            this.state.pollingInterval = null;
        }
    }
    
    /**
     * Скачивает обработанный файл
     */
    download() {
        if (this.state.downloadUrl) {
            window.location.href = this.state.downloadUrl;
        }
    }
    
    /**
     * Сбрасывает состояние процессора
     */
    reset() {
        // Сбрасываем состояние
        this.state.currentFile = null;
        this.state.jobId = null;
        this.state.downloadUrl = null;
        
        // Останавливаем опрос
        this.stopStatusPolling();
        
        // Оповещаем о сбросе
        this.events.onReset();
    }
}

// Экспортируем класс для использования в других скриптах
window.VideoProcessor = VideoProcessor;