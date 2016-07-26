import deepEqual from 'deep-equal';

/**
 * PropInspector is used to detect relationships between queries within a single
 * component.
 *
 * Given this decorator:
 *
 * @load((props) => ({
 *   user: User.getItem({ id: props.id }),
 *   posts: Posts.getList({ userName: user.name })
 * })
 *
 * we can see that `posts` is dependent on the `User` query.
 *
 * This class is created with a list of prop names that are generated by data
 * loading in tectonic.
 *
 */
export default class PropInspector {

  constructor({ queryFunc }) {
    this.queryFunc = queryFunc;
  }

  computeDependencies(props, manager) {
    const { queryFunc } = this;
    // This gives us a map of prop names to queries.
    // We can use this to determine if queries generate props which other
    // queries depend on.
    let queryMap = queryFunc(props);

    // !! Note: slightly complex issue. At this point we may be rendering
    // a componet with dependent data queries to be loaded with props and
    // state.
    //
    // IF we've already queried for the parent query we'll already pass
    // the props into the component during render() (via
    // manager.props(this.queries)).
    //
    // This means that resolving **won't change our props** for the
    // component: the component has props for the parent query in the
    // initial render, and resolving **doesnt change the props** therefore
    // componentWillReceiveProps will never get called and we won't
    // compute the query function to resolve the child queries. The child
    // queries will stay in UNDEFINED_PARAMS state forever. 
    //
    // To work around this we compute queries using the props from manager
    // up until this.queries doesn't change.
    if (manager) {
      let computedProps = manager.props(queryMap);

      while(deepEqual(queryMap, queryFunc({ ...props, computedProps })) === false) {
        queryMap = queryFunc({ ...props, computedProps });
        computedProps = manager.props(queryMap);
      }
    }

    // The accessor we're creating needs to have all default props from the
    // parent.
    // We assign it to the class for testing.
    this.accessor = { ...props };

    // Add an accessor property for each prop generated by tectonic's decorator.
    //
    // When the accessor is called we know that the query which needs these
    // props is dependent on the parent query which generated the prop.
    Object.keys(queryMap).forEach(queryProp => {
      Object.defineProperty(this.accessor, queryProp, {
        // query prop accessor
        get() {
          /**
           * TODO: Use proxies once IE13 becomes commonplace
           *
           * // this is called to refer to a query's model props within the
           * // decorator. because it refers to a model's props, it should return
           * // a proxy to an object which is called whenever the model's props are
           * // accessed:
           * //
           * // @load((props) => ({
           * //   user: User.getItem(),
           * //   posts: Post.getList({ author: props.user.name })
           * // }))
           * //
           * // ^ props.user: this accessor object, which returns a proxy. this
           * //   proxy associates relationships between queries.
           *
           * return new Proxy({}, (modelProp) => {
           *   console.log('proxy called', modelProp);
           *   // TODO: Now that we're using a proxy we can:
           *   // - assert that the model actually has this prop
           *   // - assert that we're loading and specifying that model's fields
           *   return function() {
           *     this.parent = queryProp;
           *   };
           *   // TODO:
           *   // Return props defined by the parent for this or an empty object so
           *   // that accessing child attributes returns undefined.
           * });
           */

          // Non-proxy implementation:
          // 1. Look up the query we're accessing and find its model
          // 2. Get the model's attributes
          // 3. Redefine all model attributes as functions which assign query
          //    relationships.
          const proxy = {};
          queryMap[queryProp].model.fields().forEach(f => {
            Object.defineProperty(proxy, f, {
              get() {
                // Return a function called during query construction which
                // assigns the key of the parent Query to the new Query.
                return function() {
                  this.parent = queryProp;
                };
              }
            });
          });

          return proxy;
        }
      });
    });

    // Call the decorator's query function again using the accessor.
    // This will return an object of prop names to queries with correct
    // parent relationships.
    const tree = this.queryFunc(this.accessor);

    // Here we iterate through all items in the tree and reassign parents and
    // children of each query based on the queryMap modified by the proxy above
    Object.keys(tree).forEach(node => {
      const item = queryMap[node];
      const { parent } = tree[node];

      if (parent !== undefined) {
        item.parent = queryMap[parent];
        queryMap[parent].children.push(item);
      }
    });

    return queryMap;
  }

}