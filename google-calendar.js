/**
 * Google Calendar Integration
 * Syncs events between Voice Calendar and Google Calendar
 */
class GoogleCalendarSync {
    constructor() {
        this.CLIENT_ID = '787152377158-vnn30jbt22b82vll7ckpbfs95k4d2903.apps.googleusercontent.com';
        this.API_KEY = '';
        this.DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
        this.SCOPES = 'https://www.googleapis.com/auth/calendar.events';
        
        this.tokenClient = null;
        this.isAuthorized = false;
        this.syncEnabled = false;
        
        this.initGoogleAPI();
    }
    
    async initGoogleAPI() {
        try {
            await new Promise((resolve, reject) => {
                gapi.load('client', { callback: resolve, onerror: reject });
            });
            
            await gapi.client.init({
                apiKey: this.API_KEY,
                discoveryDocs: [this.DISCOVERY_DOC],
            });
            
            // Check if already authorized
            const token = localStorage.getItem('google_calendar_token');
            if (token) {
                gapi.client.setToken(JSON.parse(token));
                this.isAuthorized = true;
                this.syncEnabled = true;
            }
            
            console.log('Google Calendar API initialized');
            return true;
        } catch (error) {
            console.error('Error initializing Google Calendar API:', error);
            return false;
        }
    }
    
    async authorize() {
        return new Promise((resolve, reject) => {
            this.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: this.CLIENT_ID,
                scope: this.SCOPES,
                callback: (tokenResponse) => {
                    if (tokenResponse.error) {
                        reject(tokenResponse.error);
                        return;
                    }
                    
                    // Store token
                    localStorage.setItem('google_calendar_token', JSON.stringify(tokenResponse));
                    gapi.client.setToken(tokenResponse);
                    this.isAuthorized = true;
                    this.syncEnabled = true;
                    resolve(true);
                },
            });
            
            this.tokenClient.requestAccessToken({ prompt: 'consent' });
        });
    }
    
    signOut() {
        const token = JSON.parse(localStorage.getItem('google_calendar_token') || '{}');
        if (token.access_token) {
            google.accounts.oauth2.revoke(token.access_token);
        }
        localStorage.removeItem('google_calendar_token');
        this.isAuthorized = false;
        this.syncEnabled = false;
        gapi.client.setToken(null);
    }
    
    // Create event in Google Calendar
    async createEvent(event) {
        if (!this.isAuthorized) return null;
        
        const startDateTime = new Date(event.date + 'T' + event.start);
        const endDateTime = new Date(event.date + 'T' + event.end);
        
        const googleEvent = {
            summary: event.title,
            description: event.notes || '',
            start: {
                dateTime: startDateTime.toISOString(),
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            },
            end: {
                dateTime: endDateTime.toISOString(),
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            }
        };
        
        try {
            const response = await gapi.client.calendar.events.insert({
                calendarId: 'primary',
                resource: googleEvent
            });
            
            return response.result.id;
        } catch (error) {
            console.error('Error creating Google Calendar event:', error);
            return null;
        }
    }
    
    // Update event in Google Calendar
    async updateEvent(googleEventId, event) {
        if (!this.isAuthorized || !googleEventId) return false;
        
        const startDateTime = new Date(event.date + 'T' + event.start);
        const endDateTime = new Date(event.date + 'T' + event.end);
        
        const googleEvent = {
            summary: event.title,
            description: event.notes || '',
            start: {
                dateTime: startDateTime.toISOString(),
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            },
            end: {
                dateTime: endDateTime.toISOString(),
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            }
        };
        
        try {
            await gapi.client.calendar.events.update({
                calendarId: 'primary',
                eventId: googleEventId,
                resource: googleEvent
            });
            return true;
        } catch (error) {
            console.error('Error updating Google Calendar event:', error);
            return false;
        }
    }
    
    // Delete event from Google Calendar
    async deleteEvent(googleEventId) {
        if (!this.isAuthorized || !googleEventId) return false;
        
        try {
            await gapi.client.calendar.events.delete({
                calendarId: 'primary',
                eventId: googleEventId
            });
            return true;
        } catch (error) {
            console.error('Error deleting Google Calendar event:', error);
            return false;
        }
    }
    
    // Fetch events from Google Calendar for a date range
    async fetchEvents(timeMin, timeMax) {
        if (!this.isAuthorized) return [];
        
        try {
            const response = await gapi.client.calendar.events.list({
                calendarId: 'primary',
                timeMin: timeMin.toISOString(),
                timeMax: timeMax.toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
                maxResults: 250
            });
            
            return response.result.items.map(item => ({
                id: 'gcal_' + item.id,
                googleEventId: item.id,
                title: item.summary || 'Untitled',
                date: item.start.dateTime 
                    ? item.start.dateTime.split('T')[0]
                    : item.start.date,
                start: item.start.dateTime 
                    ? item.start.dateTime.split('T')[1].substring(0, 5)
                    : '00:00',
                end: item.end.dateTime 
                    ? item.end.dateTime.split('T')[1].substring(0, 5)
                    : '23:59',
                notes: item.description || '',
                color: '#3b82f6',
                fromGoogle: true
            }));
        } catch (error) {
            console.error('Error fetching Google Calendar events:', error);
            return [];
        }
    }
    
    // Sync all local events to Google Calendar
    async syncLocalToGoogle(localEvents) {
        if (!this.isAuthorized) return;
        
        for (const event of localEvents) {
            if (event.fromGoogle) continue; // Skip events that came from Google
            
            if (!event.googleEventId) {
                // Create in Google
                const googleId = await this.createEvent(event);
                if (googleId) {
                    event.googleEventId = googleId;
                }
            } else {
                // Update in Google
                await this.updateEvent(event.googleEventId, event);
            }
        }
    }
    
    // Import Google events to local storage
    async importFromGoogle() {
        if (!this.isAuthorized) return [];
        
        const now = new Date();
        const timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const timeMax = new Date(now.getFullYear(), now.getMonth() + 2, 31);
        
        return await this.fetchEvents(timeMin, timeMax);
    }
}

// Export for use in app.js
window.GoogleCalendarSync = GoogleCalendarSync;