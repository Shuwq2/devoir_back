export function createOrderEventHub() {
  const subscribers = new Set();

  return {
    subscribe(user, send) {
      const subscriber = { userId: user.id, role: user.role, send };
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },

    publish(event, order) {
      for (const subscriber of subscribers) {
        const staff = subscriber.role === "STAFF" || subscriber.role === "ADMIN";
        const receivesEvent = event === "order.created"
          ? staff
          : staff || subscriber.userId === order.customerId;
        if (receivesEvent) subscriber.send(event, order);
      }
    },
  };
}
