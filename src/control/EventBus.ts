import { GameEvent, GameEventType } from '../types';

type EventCallback = (event: GameEvent) => void;

/**
 * Central event bus for communication between layers
 */
export class EventBus {
  private static instance: EventBus;
  private listeners: Map<GameEventType, Set<EventCallback>> = new Map();
  private globalListeners: Set<EventCallback> = new Set();

  private constructor() {}

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /**
   * Subscribe to a specific event type
   */
  on(eventType: GameEventType, callback: EventCallback): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(eventType)?.delete(callback);
    };
  }

  /**
   * Subscribe to all events
   */
  onAll(callback: EventCallback): () => void {
    this.globalListeners.add(callback);
    return () => {
      this.globalListeners.delete(callback);
    };
  }

  /**
   * Emit an event
   */
  emit(type: GameEventType, data: any): void {
    const event: GameEvent = {
      type,
      timestamp: Date.now(),
      data,
    };

    // Notify specific listeners
    this.listeners.get(type)?.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        console.error(`Error in event listener for ${type}:`, error);
      }
    });

    // Notify global listeners
    this.globalListeners.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        console.error(`Error in global event listener:`, error);
      }
    });
  }

  /**
   * Clear all listeners
   */
  clear(): void {
    this.listeners.clear();
    this.globalListeners.clear();
  }
}

export const eventBus = EventBus.getInstance();
