/**
 * Voice Calendar - On-device speech recognition
 * Uses Web Speech API (SpeechRecognition) which works offline on Chrome/Safari
 */
class VoiceCalendar {
    constructor() {
        // State
        this.currentDate = new Date();
        this.selectedDate = new Date();
        this.currentView = 'month'; // 'month' | 'week' | 'agenda'
        this.events = this.loadFromStorage();
        this.editingId = null;

        // Speech
        this.recognition = null;
        this.isListening = false;
        this.speechSupported = false;

        // Colors for event categories (cycled)
        this.eventColors = [
            '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b',
            '#22c55e', '#06b6d4', '#ef4444', '#f97316'
        ];

        this.init();
    }

    // ==================== INITIALIZATION ====================
    init() {
        this.initSpeechRecognition();
        this.bindEvents();
        this.renderAll();
        this.registerSW();
    }

    registerSW() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }
    }

    // ==================== SPEECH RECOGNITION ====================
    initSpeechRecognition() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            this.setVoiceStatus('Speech not supported in this browser', false);
            return;
        }

        this.speechSupported = true;
        this.recognition = new SR();
        this.recognition.continuous = false;
        this.recognition.interimResults = true; // Show partial results
        this.recognition.lang = 'en-US';
        this.recognition.maxAlternatives = 1;

        // Interim results (while speaking)
        this.recognition.onresult = (event) => {
            let interim = '';
            let final = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    final += transcript;
                } else {
                    interim += transcript;
                }
            }

            if (interim) {
                this.showVoiceFeedback(interim, true);
            }

            if (final) {
                this.processVoiceCommand(final.trim());
            }
        };

        this.recognition.onerror = (event) => {
            console.warn('Speech error:', event.error);
            this.stopListening();

            switch (event.error) {
                case 'not-allowed':
                    this.showVoiceFeedback('Microphone access denied. Check settings.', false);
                    break;
                case 'no-speech':
                    this.showVoiceFeedback('No speech detected. Try again.', false);
                    break;
                case 'network':
                    // Safari sometimes needs network for first use
                    this.showVoiceFeedback('Network needed for first use. Try again.', false);
                    break;
                default:
                    this.showVoiceFeedback('Tap mic and speak clearly', false);
            }
        };

        this.recognition.onend = () => {
            this.stopListening();
        };

        // On Safari, speech recognition may stop after a few seconds of silence
        this.recognition.onspeechend = () => {
            // Will trigger onend naturally
        };
    }

    startListening() {
        if (!this.speechSupported || !this.recognition) return;

        this.isListening = true;
        const micBtn = document.getElementById('micButton');
        micBtn.classList.add('listening');
        document.getElementById('voiceStatus').textContent = 'Listening...';

        try {
            this.recognition.start();
        } catch (e) {
            // Already started - stop and restart
            this.recognition.stop();
            setTimeout(() => {
                try { this.recognition.start(); } catch(e2) {}
            }, 100);
        }
    }

    stopListening() {
        this.isListening = false;
        document.getElementById('micButton').classList.remove('listening');
        document.getElementById('voiceStatus').textContent = 'Tap mic & speak';
    }

    showVoiceFeedback(text, isInterim) {
        const el = document.getElementById('voiceExamples');
        if (isInterim) {
            el.textContent = `🎤 "${text}"`;
            el.style.color = '#a1a1aa';
        } else {
            el.textContent = text;
            el.style.color = '#71717a';
        }
        // Reset after 4 seconds
        clearTimeout(this._feedbackTimeout);
        if (!isInterim) {
            this._feedbackTimeout = setTimeout(() => {
                el.textContent = 'Try: "Grocery shopping tomorrow 9 to 10 AM"';
                el.style.color = '#71717a';
            }, 4000);
        }
    }

    setVoiceStatus(text, supported = true) {
        document.getElementById('voiceStatus').textContent = text;
        if (!supported) {
            document.getElementById('micButton').style.opacity = '0.5';
        }
    }

    // ==================== VOICE COMMAND PARSING ====================
    processVoiceCommand(transcript) {
        console.log('Final transcript:', transcript);
        const result = this.parseNaturalLanguage(transcript);

        if (result) {
            const startDate = new Date(result.date);
            startDate.setHours(result.startHour, result.startMinute || 0);
            const endDate = new Date(result.date);
            endDate.setHours(result.endHour, result.endMinute || 0);

            this.createEvent(result.title, startDate, endDate, result.notes || '');
            this.showToast(`✅ Created: ${result.title}`);
            this.showVoiceFeedback(`Created: "${result.title}"`, false);
            this.selectedDate = new Date(result.date);
            this.renderAll();
        } else {
            this.showVoiceFeedback(
                'Try: "Meeting with John tomorrow 2 to 3 PM" or "Dentist Friday at 10 AM"',
                false
            );
        }
    }

    parseNaturalLanguage(text) {
        text = text.toLowerCase().trim();

        // Remove prefixes like "create event", "add", "schedule", "please"
        text = text.replace(/^(please\s+)?(create|add|schedule|set|make|new)(\s+an?\s+)?(event\s+|appointment\s+|meeting\s+)?/i, '').trim();

        // Try multiple patterns
        const patterns = [
            // Pattern 1: "title tomorrow/today/on [date] from X to Y [am/pm]"
            {
                regex: /^(.+?)\s+(today|tomorrow|tonight)\s+(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(.*))?$/i,
                parse: (m) => ({
                    title: m[1].trim(),
                    date: this.resolveDate(m[2]),
                    startHour: this.to24Hour(parseInt(m[3]), m[5]),
                    startMinute: m[4] ? parseInt(m[4]) : 0,
                    endHour: this.to24Hour(parseInt(m[6]), m[8]),
                    endMinute: m[7] ? parseInt(m[7]) : 0,
                    notes: m[9]?.trim() || ''
                })
            },
            // Pattern 2: "title on dayname from X to Y [am/pm]"
            {
                regex: /^(.+?)\s+on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(.*))?$/i,
                parse: (m) => ({
                    title: m[1].trim(),
                    date: this.resolveDate(m[2]),
                    startHour: this.to24Hour(parseInt(m[3]), m[5]),
                    startMinute: m[4] ? parseInt(m[4]) : 0,
                    endHour: this.to24Hour(parseInt(m[6]), m[8]),
                    endMinute: m[7] ? parseInt(m[7]) : 0,
                    notes: m[9]?.trim() || ''
                })
            },
            // Pattern 3: "title tomorrow/on day at X [am/pm]"
            {
                regex: /^(.+?)\s+(today|tomorrow|on\s+\w+day)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(.*))?$/i,
                parse: (m) => ({
                    title: m[1].trim(),
                    date: this.resolveDate(m[2]),
                    startHour: this.to24Hour(parseInt(m[3]), m[5]),
                    startMinute: m[4] ? parseInt(m[4]) : 0,
                    endHour: this.to24Hour(parseInt(m[3]) + 1, m[5]), // Default 1 hour
                    endMinute: m[4] ? parseInt(m[4]) : 0,
                    notes: m[6]?.trim() || ''
                })
            },
            // Pattern 4: "title [date] [time] to [time]"
            {
                regex: /^(.+?)\s+(today|tomorrow)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
                parse: (m) => ({
                    title: m[1].trim(),
                    date: this.resolveDate(m[2]),
                    startHour: this.to24Hour(parseInt(m[3]), m[5]),
                    startMinute: m[4] ? parseInt(m[4]) : 0,
                    endHour: this.to24Hour(parseInt(m[6]), m[8]),
                    endMinute: m[7] ? parseInt(m[7]) : 0,
                    notes: ''
                })
            }
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern.regex);
            if (match) {
                const result = pattern.parse(match);
                // Validate
                if (result.date && !isNaN(result.startHour) && !isNaN(result.endHour) && result.title) {
                    return result;
                }
            }
        }

        return null;
    }

    resolveDate(str) {
        const today = new Date();
        today.setHours(0,0,0,0);

        str = str.toLowerCase();

        if (str === 'today') return new Date(today);
        if (str === 'tomorrow') {
            const d = new Date(today);
            d.setDate(d.getDate() + 1);
            return d;
        }
        if (str === 'tonight') return new Date(today);

        // Day names
        const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
        for (let i = 0; i < days.length; i++) {
            if (str.includes(days[i])) {
                const d = new Date(today);
                const currentDay = d.getDay();
                let diff = i - currentDay;
                if (diff <= 0) diff += 7; // Next occurrence
                d.setDate(d.getDate() + diff);
                return d;
            }
        }

        return new Date(today); // Fallback to today
    }

    to24Hour(hour, ampm) {
        if (!ampm) return hour; // Assume already 24h or context makes sense
        ampm = ampm.toLowerCase();
        if (ampm === 'pm' && hour !== 12) return hour + 12;
        if (ampm === 'am' && hour === 12) return 0;
        return hour;
    }

    // ==================== STORAGE ====================
    loadFromStorage() {
        try {
            const data = localStorage.getItem('voicecal_events');
            return data ? JSON.parse(data) : [];
        } catch(e) {
            return [];
        }
    }

    saveToStorage() {
        localStorage.setItem('voicecal_events', JSON.stringify(this.events));
    }

    // ==================== EVENT CRUD ====================
    createEvent(title, startDate, endDate, notes = '') {
        const dateKey = this.dateKey(startDate);
        const event = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            title: this.capitalize(title),
            date: dateKey,
            start: this.timeStr(startDate),
            end: this.timeStr(endDate),
            notes: notes,
            color: this.eventColors[this.events.length % this.eventColors.length],
            created: new Date().toISOString()
        };
        this.events.push(event);
        this.saveToStorage();
    }

    updateEvent(id, title, dateKey, startTime, endTime, notes) {
        const idx = this.events.findIndex(e => e.id === id);
        if (idx === -1) return;
        this.events[idx] = {
            ...this.events[idx],
            title: this.capitalize(title),
            date: dateKey,
            start: startTime,
            end: endTime,
            notes: notes
        };
        this.saveToStorage();
    }

    deleteEvent(id) {
        this.events = this.events.filter(e => e.id !== id);
        this.saveToStorage();
    }

    getEventsForDate(dateKey) {
        return this.events
            .filter(e => e.date === dateKey)
            .sort((a, b) => a.start.localeCompare(b.start));
    }

    getEventsForRange(startKey, endKey) {
        return this.events
            .filter(e => e.date >= startKey && e.date <= endKey)
            .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    }

    // ==================== RENDERING ====================
    renderAll() {
        this.updateNavTitle();
        switch (this.currentView) {
            case 'month': this.renderMonthView(); break;
            case 'week': this.renderWeekView(); break;
            case 'agenda': this.renderAgendaView(); break;
        }
    }

    updateNavTitle() {
        const opts = { month: 'long', year: 'numeric' };
        let title;
        switch (this.currentView) {
            case 'month':
                title = this.currentDate.toLocaleDateString('en-US', opts);
                break;
            case 'week':
                title = this.getWeekRangeString();
                break;
            case 'agenda':
                title = this.currentDate.toLocaleDateString('en-US', opts);
                break;
        }
        document.getElementById('navTitle').textContent = title;
    }

    getWeekRangeString() {
        const start = this.getWeekStart(this.currentDate);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        const fmt = { month: 'short', day: 'numeric' };
        return `${start.toLocaleDateString('en-US', fmt)} - ${end.toLocaleDateString('en-US', fmt)}`;
    }

    // ---- MONTH VIEW ----
    renderMonthView() {
        const grid = document.getElementById('monthGrid');
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const today = this.dateKey(new Date());
        const selectedKey = this.dateKey(this.selectedDate);

        let html = '';

        // Previous month padding
        for (let i = 0; i < firstDay; i++) {
            html += '<div class="month-cell other-month"></div>';
        }

        // Month days
        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(year, month, d);
            const key = this.dateKey(date);
            const events = this.getEventsForDate(key);

            let cls = ['month-cell'];
            if (key === today) cls.push('today');
            if (key === selectedKey) cls.push('selected');

            // Event indicators
            let eventHtml = '';
            if (events.length > 0) {
                const dots = events.slice(0, 3).map(e =>
                    `<span class="event-dot" style="background:${e.color}"></span>`
                ).join('');
                const count = events.length > 3 ? `<span class="event-count">+${events.length - 3}</span>` : '';
                eventHtml = `<div class="event-dots">${dots}${count}</div>`;
            }

            html += `
                <div class="${cls.join(' ')}" data-date="${key}">
                    <span>${d}</span>
                    ${eventHtml}
                </div>
            `;
        }

        grid.innerHTML = html;

        // Click handlers
        grid.querySelectorAll('.month-cell:not(.other-month)').forEach(cell => {
            cell.addEventListener('click', () => {
                const key = cell.dataset.date;
                this.selectedDate = this.fromDateKey(key);
                this.renderAll();
            });
        });
    }

    // ---- WEEK VIEW ----
    renderWeekView() {
        const container = document.getElementById('weekScroll');
        const weekStart = this.getWeekStart(this.currentDate);
        const today = this.dateKey(new Date());

        // Time slots (6 AM to 10 PM)
        const hours = [];
        for (let h = 6; h <= 22; h++) {
            hours.push(h);
        }

        let html = '<div class="week-layout">';

        // Time column
        html += '<div class="week-time-column">';
        hours.forEach(h => {
            const suffix = h >= 12 ? 'PM' : 'AM';
            const display = h > 12 ? h - 12 : (h === 0 ? 12 : h);
            html += `<div class="time-slot-label">${display} ${suffix}</div>`;
        });
        html += '</div>';

        // Days columns
        html += '<div class="week-days-grid">';

        for (let d = 0; d < 7; d++) {
            const date = new Date(weekStart);
            date.setDate(date.getDate() + d);
            const key = this.dateKey(date);

            const isToday = key === today;
            const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
            const dayNum = date.getDate();

            html += `
                <div class="week-day-header${isToday ? ' today' : ''}">
                    ${dayName}
                    <span class="day-num">${dayNum}</span>
                </div>
            `;
        }

        // Event columns
        for (let d = 0; d < 7; d++) {
            const date = new Date(weekStart);
            date.setDate(date.getDate() + d);
            const key = this.dateKey(date);
            const events = this.getEventsForDate(key);

            html += '<div class="week-day-column">';

            events.forEach(event => {
                const startMin = this.timeToMinutes(event.start);
                const endMin = this.timeToMinutes(event.end);
                // Clamp to 6 AM - 10 PM
                const displayStart = Math.max(startMin, 360); // 6 AM = 360 min
                const displayEnd = Math.min(endMin, 1320); // 10 PM = 1320 min
                const duration = displayEnd - displayStart;
                if (duration <= 0) return;

                const top = ((displayStart - 360) / 960) * 100; // 6AM-10PM = 960 min
                const height = (duration / 960) * 100;

                html += `
                    <div class="week-event"
                         style="top:${top}%;height:${Math.max(height, 2)}%;background:${event.color}"
                         data-id="${event.id}"
                         title="${this.escapeHtml(event.title)} (${event.start}-${event.end})">
                        ${this.escapeHtml(event.title)}
                    </div>
                `;
            });

            html += '</div>';
        }

        html += '</div></div>';
        container.innerHTML = html;

        // Click handlers
        container.querySelectorAll('.week-event').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openEditModal(el.dataset.id);
            });
        });
    }

    // ---- AGENDA VIEW ----
    renderAgendaView() {
        const list = document.getElementById('agendaList');
        const today = this.dateKey(new Date());

        // Get events for next 14 days
        const startKey = this.dateKey(new Date());
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 14);
        const endKey = this.dateKey(endDate);

        const events = this.getEventsForRange(startKey, endKey);

        if (events.length === 0) {
            list.innerHTML = `
                <div class="agenda-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <p>No upcoming events</p>
                    <p style="font-size:12px;margin-top:4px;">Use voice or tap + to add</p>
                </div>`;
            return;
        }

        // Group by date
        let html = '';
        let currentDateKey = '';

        events.forEach(event => {
            if (event.date !== currentDateKey) {
                currentDateKey = event.date;
                const date = this.fromDateKey(event.date);
                const isToday = event.date === today;

                const dateLabel = isToday ? 'Today' :
                    event.date === this.dateKey(new Date(Date.now() + 86400000)) ? 'Tomorrow' :
                    date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

                html += `
                    <div class="agenda-date-header${isToday ? ' today' : ''}">
                        <span class="date-badge">${isToday ? 'Today' : date.toLocaleDateString('en-US', {month:'short',day:'numeric'})}</span>
                        ${dateLabel}
                    </div>`;
            }

            const startTime = this.formatDisplayTime(event.start);
            const endTime = this.formatDisplayTime(event.end);

            html += `
                <div class="agenda-event" data-id="${event.id}">
                    <div class="time-block">${startTime}<br><span style="font-size:10px;color:#71717a">to ${endTime}</span></div>
                    <div class="event-details">
                        <div class="event-card-title">${this.escapeHtml(event.title)}</div>
                        ${event.notes ? `<div class="event-card-notes">${this.escapeHtml(event.notes)}</div>` : ''}
                    </div>
                    <div style="width:4px;height:40px;border-radius:2px;background:${event.color};flex-shrink:0;"></div>
                </div>`;
        });

        list.innerHTML = html;

        // Click handlers
        list.querySelectorAll('.agenda-event').forEach(el => {
            el.addEventListener('click', () => this.openEditModal(el.dataset.id));
        });
    }

    // ==================== MODAL ====================
    openNewModal() {
        this.editingId = null;
        document.getElementById('modalTitle').textContent = 'New Event';
        document.getElementById('eventForm').reset();
        document.getElementById('eventDate').value = this.dateKey(this.selectedDate);
        document.getElementById('eventStart').value = '09:00';
        document.getElementById('eventEnd').value = '10:00';
        document.getElementById('eventNotes').value = '';
        document.getElementById('deleteEventBtn').style.display = 'none';
        document.getElementById('eventModal').classList.add('active');
        setTimeout(() => document.getElementById('eventTitle').focus(), 300);
    }

    openEditModal(id) {
        const event = this.events.find(e => e.id === id);
        if (!event) return;

        this.editingId = id;
        document.getElementById('modalTitle').textContent = 'Edit Event';
        document.getElementById('eventTitle').value = event.title;
        document.getElementById('eventDate').value = event.date;
        document.getElementById('eventStart').value = event.start;
        document.getElementById('eventEnd').value = event.end;
        document.getElementById('eventNotes').value = event.notes || '';
        document.getElementById('deleteEventBtn').style.display = 'block';
        document.getElementById('eventModal').classList.add('active');
    }

    closeModal() {
        document.getElementById('eventModal').classList.remove('active');
        this.editingId = null;
    }

    handleFormSubmit(e) {
        e.preventDefault();

        const title = document.getElementById('eventTitle').value.trim();
        const dateKey = document.getElementById('eventDate').value;
        const startTime = document.getElementById('eventStart').value;
        const endTime = document.getElementById('eventEnd').value;
        const notes = document.getElementById('eventNotes').value.trim();

        if (!title || !dateKey || !startTime || !endTime) return;

        if (this.editingId) {
            this.updateEvent(this.editingId, title, dateKey, startTime, endTime, notes);
            this.showToast('Event updated');
        } else {
            const startDate = this.fromDateKey(dateKey);
            const [sh, sm] = startTime.split(':').map(Number);
            const [eh, em] = endTime.split(':').map(Number);
            startDate.setHours(sh, sm);
            const endDate = this.fromDateKey(dateKey);
            endDate.setHours(eh, em);

            this.createEvent(title, startDate, endDate, notes);
            this.showToast('Event created');
        }

        this.closeModal();
        this.renderAll();
    }

    handleDelete() {
        if (!this.editingId) return;
        if (confirm('Delete this event?')) {
            this.deleteEvent(this.editingId);
            this.showToast('Event deleted');
            this.closeModal();
            this.renderAll();
        }
    }

    // ==================== EVENT BINDING ====================
    bindEvents() {
        // Voice mic button
        document.getElementById('micButton').addEventListener('click', () => {
            if (this.isListening) {
                this.recognition?.stop();
            } else {
                this.startListening();
            }
        });

        // View switcher
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentView = btn.dataset.view;

                document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
                document.getElementById(this.currentView + 'View').classList.add('active');

                this.renderAll();
            });
        });

        // Navigation arrows
        document.getElementById('prevPeriod').addEventListener('click', () => this.navigate(-1));
        document.getElementById('nextPeriod').addEventListener('click', () => this.navigate(1));

        // Swipe navigation on views
        ['monthGrid', 'weekScroll', 'agendaList'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            let touchStartX = 0;
            el.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; });
            el.addEventListener('touchend', (e) => {
                const diff = e.changedTouches[0].clientX - touchStartX;
                if (Math.abs(diff) > 60) {
                    this.navigate(diff > 0 ? -1 : 1);
                }
            });
        });

        // Today button
        document.getElementById('todayBtn').addEventListener('click', () => {
            const today = new Date();
            today.setHours(0,0,0,0);
            this.currentDate = today;
            this.selectedDate = today;
            this.renderAll();
        });

        // FAB
        document.getElementById('addEventFab').addEventListener('click', () => this.openNewModal());

        // Modal
        document.getElementById('closeModal').addEventListener('click', () => this.closeModal());
        document.getElementById('eventModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('eventModal')) this.closeModal();
        });
        document.getElementById('eventForm').addEventListener('submit', (e) => this.handleFormSubmit(e));
        document.getElementById('deleteEventBtn').addEventListener('click', () => this.handleDelete());

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeModal();
            if (e.key === 'ArrowLeft' && !e.target.closest('input,textarea')) this.navigate(-1);
            if (e.key === 'ArrowRight' && !e.target.closest('input,textarea')) this.navigate(1);
            if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                e.preventDefault();
                this.openNewModal();
            }
        });
    }

    navigate(direction) {
        switch (this.currentView) {
            case 'month':
                this.currentDate.setMonth(this.currentDate.getMonth() + direction);
                break;
            case 'week':
                this.currentDate.setDate(this.currentDate.getDate() + (direction * 7));
                break;
            case 'agenda':
                this.currentDate.setMonth(this.currentDate.getMonth() + direction);
                break;
        }
        this.renderAll();
    }

    // ==================== UTILITIES ====================
    dateKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    fromDateKey(key) {
        const [y, m, d] = key.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        date.setHours(0,0,0,0);
        return date;
    }

    timeStr(date) {
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
    }

    timeToMinutes(timeStr) {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    }

    formatDisplayTime(timeStr) {
        const [h, m] = timeStr.split(':').map(Number);
        const suffix = h >= 12 ? 'PM' : 'AM';
        const displayH = h > 12 ? h - 12 : (h === 0 ? 12 : h);
        return `${displayH}:${String(m).padStart(2, '0')} ${suffix}`;
    }

    getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        d.setDate(d.getDate() - day);
        d.setHours(0,0,0,0);
        return d;
    }

    capitalize(str) {
        return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    showToast(msg, type = 'success') {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.className = `toast ${type} show`;
        clearTimeout(this._toastTimeout);
        this._toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 2000);
    }
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
    new VoiceCalendar();
});